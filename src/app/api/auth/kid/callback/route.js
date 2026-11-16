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

    // Fetch full OIDC UserInfo if access_token is present to guarantee all claims (Telegram, Gmail, etc.)
    let fullUserInfo = null;
    if (tokens.access_token) {
      try {
        fullUserInfo = await kidServer.getUserInfo(tokens.access_token);
      } catch (uiErr) {
        console.warn("[KID callback] getUserInfo warning:", uiErr.message);
      }
    }

    // Direct database synchronization in unified full-stack application
    await connectDB();
    const kidProfile = { ...(tokens.user || {}), ...(fullUserInfo || {}) };
    const sub = kidProfile.sub;

    if (!sub) {
      throw new Error("Missing subject identifier (sub) from KID profile");
    }

    const finalKid = kidProfile.kid || "";
    const finalName =
      kidProfile.name ||
      (kidProfile.given_name ? `${kidProfile.given_name} ${kidProfile.family_name || ""}`.trim() : "") ||
      (finalKid ? `KID User #${finalKid}` : "KID Customer");
    const finalEmail = (kidProfile.email || `${sub}@kid.user`).toLowerCase();
    const finalEmailVerified =
      kidProfile.email_verified ?? Boolean(kidProfile.email);
    const finalPhone =
      kidProfile.phone || kidProfile.phone_number || kidProfile.phoneNumber || "";
    const finalPhoneVerified = Boolean(kidProfile.phone_number_verified);
    const finalWallet =
      kidProfile.wallet_address || kidProfile.wallet?.address || "";
    const finalTelegramUsername = kidProfile.telegram_username || "";
    const finalTelegramId = kidProfile.telegram_id ? String(kidProfile.telegram_id) : "";
    const finalPicture = kidProfile.picture || "";
    const finalPreferredUsername = kidProfile.preferred_username || "";

    let user = await User.findOne({ sub });
    if (!user && finalEmail) {
      user = await User.findOne({ email: finalEmail });
      if (user) {
        user.sub = sub;
        if (finalKid) user.kid = finalKid;
        if (finalWallet) user.walletAddress = finalWallet;
        if (finalTelegramUsername) user.telegramUsername = finalTelegramUsername;
        if (finalTelegramId) user.telegramId = finalTelegramId;
        if (finalPicture) user.picture = finalPicture;
        if (finalPreferredUsername) user.preferredUsername = finalPreferredUsername;
        if (typeof finalEmailVerified === "boolean") user.emailVerified = finalEmailVerified;
        if (typeof finalPhoneVerified === "boolean") user.phoneVerified = finalPhoneVerified;
        await user.save();
      }
    }

    if (!user) {
      user = await User.create({
        sub,
        kid: finalKid,
        name: finalName,
        email: finalEmail,
        emailVerified: finalEmailVerified,
        phoneNumber: finalPhone,
        phoneVerified: finalPhoneVerified,
        walletAddress: finalWallet,
        telegramUsername: finalTelegramUsername,
        telegramId: finalTelegramId,
        picture: finalPicture,
        preferredUsername: finalPreferredUsername,
        role: "CUSTOMER",
        status: "ACTIVE",
      });
    } else {
      let hasChanges = false;
      if (finalKid && user.kid !== finalKid) { user.kid = finalKid; hasChanges = true; }
      if (finalWallet && user.walletAddress !== finalWallet) { user.walletAddress = finalWallet; hasChanges = true; }
      if (finalName && user.name !== finalName && !user.name.startsWith("Host")) { user.name = finalName; hasChanges = true; }
      if (finalTelegramUsername && user.telegramUsername !== finalTelegramUsername) { user.telegramUsername = finalTelegramUsername; hasChanges = true; }
      if (finalTelegramId && user.telegramId !== finalTelegramId) { user.telegramId = finalTelegramId; hasChanges = true; }
      if (finalPicture && user.picture !== finalPicture) { user.picture = finalPicture; hasChanges = true; }
      if (finalPreferredUsername && user.preferredUsername !== finalPreferredUsername) { user.preferredUsername = finalPreferredUsername; hasChanges = true; }
      if (typeof finalEmailVerified === "boolean" && user.emailVerified !== finalEmailVerified) { user.emailVerified = finalEmailVerified; hasChanges = true; }
      if (typeof finalPhoneVerified === "boolean" && user.phoneVerified !== finalPhoneVerified) { user.phoneVerified = finalPhoneVerified; hasChanges = true; }
      if (hasChanges) await user.save();
    }

    const token = signToken({ id: user._id, role: user.role }, { expiresIn: "7d" });

    const formattedUser = {
      _id: user._id,
      name: user.name,
      email: user.email,
      emailVerified: Boolean(user.emailVerified),
      role: user.role,
      status: user.status || "ACTIVE",
      sub: user.sub || null,
      kid: user.kid || null,
      walletAddress: user.walletAddress || null,
      phoneNumber: user.phoneNumber,
      phoneVerified: Boolean(user.phoneVerified),
      telegramUsername: user.telegramUsername || null,
      telegramId: user.telegramId || null,
      picture: user.picture || null,
      preferredUsername: user.preferredUsername || null,
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
