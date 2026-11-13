/**
 * KID OAuth — Token Exchange API Route
 * POST /api/auth/kid/callback
 */

import { isKIDError } from '@kid-oauth/sdk/server';
import { NextResponse } from 'next/server';
import { getKidServer } from '@/lib/kid-server';
import { connectDB } from '@/lib/db';
import { User } from '@/models/User';
import { signToken } from '@/lib/auth';

export async function POST(request) {
  try {
    const body = await request.json();
    const { code, codeVerifier, redirectUri: clientRedirectUri } = body;

    if (!code || !codeVerifier) {
      return NextResponse.json(
        { error: 'invalid_request', message: 'Missing authorization code or code_verifier' },
        { status: 400 }
      );
    }

    // Determine the redirect URI matching where the request originated
    let redirectUri = clientRedirectUri;
    if (!redirectUri) {
      const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
      const proto = request.headers.get("x-forwarded-proto") || "https";
      if (host) {
        redirectUri = `${proto}://${host}/auth/kid/callback`;
      } else {
        redirectUri = process.env.KID_REDIRECT_URI || 'http://localhost:3000/auth/kid/callback';
      }
    }

    const kidServer = getKidServer(redirectUri);

    // Server-side code exchange with PKCE verifier
    const tokens = await kidServer.exchangeCode({ code, codeVerifier });

    // Handle merged accounts (Rule 4):
    if (tokens.user?.merged_from?.length) {
      for (const closed of tokens.user.merged_from) {
        console.log(`[KID] Merged sub: ${closed.sub} -> survivor sub: ${tokens.user.sub}`);
      }
    }

    // Direct database synchronization in unified full-stack application
    await connectDB();
    const kidProfile = tokens.user || {};
    const sub = kidProfile.sub;

    if (!sub) {
      throw new Error("Missing subject identifier (sub) from KID profile");
    }

    const finalKid = kidProfile.kid || "";
    const finalName = kidProfile.name || (finalKid ? `KID User #${finalKid}` : "KID Customer");
    const finalEmail = (kidProfile.email || `${sub}@kid.user`).toLowerCase();
    const finalPhone = kidProfile.phone || kidProfile.phoneNumber || "";
    const finalWallet = kidProfile.wallet?.address || "";

    let user = await User.findOne({ sub });
    if (!user && finalEmail) {
      user = await User.findOne({ email: finalEmail });
      if (user) {
        user.sub = sub;
        if (finalKid) user.kid = finalKid;
        if (finalWallet) user.walletAddress = finalWallet;
        await user.save();
      }
    }

    if (!user) {
      user = await User.create({
        sub,
        kid: finalKid,
        name: finalName,
        email: finalEmail,
        phoneNumber: finalPhone,
        walletAddress: finalWallet,
        role: "CUSTOMER",
        status: "ACTIVE",
      });
    } else {
      if (finalKid && user.kid !== finalKid) user.kid = finalKid;
      if (finalWallet && user.walletAddress !== finalWallet) user.walletAddress = finalWallet;
      if (finalName && user.name !== finalName) user.name = finalName;
      await user.save();
    }

    const token = signToken({ id: user._id, role: user.role }, { expiresIn: "7d" });

    const formattedUser = {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status || "ACTIVE",
      sub: user.sub || null,
      kid: user.kid || null,
      walletAddress: user.walletAddress || null,
      phoneNumber: user.phoneNumber,
      driverLicense: user.driverLicense,
    };

    const res = NextResponse.json({
      access_token: token,
      token,
      refreshToken: token,
      refresh_token: token,
      kid_access_token: tokens.access_token,
      kid_refresh_token: tokens.refresh_token,
      expires_in: tokens.expires_in,
      scope: tokens.scope,
      user: formattedUser,
    });

    res.cookies.set("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60,
      path: "/",
    });

    return res;
  } catch (err) {
    console.error('[KID callback] token exchange failed:', err);
    const message = isKIDError(err) ? err.message : (err.message || 'Failed to exchange authorization code');
    const status = err?.statusCode || (err?.code === 'token_expired' ? 400 : 500);

    return NextResponse.json(
      {
        error: err?.code || 'token_exchange_failed',
        message,
      },
      { status }
    );
  }
}
