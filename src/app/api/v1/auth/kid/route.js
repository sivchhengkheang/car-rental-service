import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { User } from "@/models/User";
import { verifyKidOAuthToken, signToken } from "@/lib/auth";

export async function POST(req) {
  try {
    await connectDB();
    const body = await req.json();
    const {
      accessToken,
      sub: providedSub,
      kid,
      name,
      email,
      emailVerified,
      phoneNumber,
      phoneVerified,
      walletAddress,
      telegramUsername,
      telegramId,
      picture,
      preferredUsername,
    } = body;

    let kidProfile = null;
    if (accessToken) {
      kidProfile = await verifyKidOAuthToken(accessToken);
    }

    const sub = kidProfile?.sub || providedSub;
    if (!sub) {
      return NextResponse.json(
        { success: false, message: "Missing KID subject identifier (sub)" },
        { status: 400 }
      );
    }

    const finalKid = kidProfile?.kid || kid || "";
    const finalName =
      kidProfile?.name ||
      (kidProfile?.given_name ? `${kidProfile.given_name} ${kidProfile.family_name || ""}`.trim() : "") ||
      name ||
      (finalKid ? `KID User #${finalKid}` : "KID Customer");
    const finalEmail = (
      kidProfile?.email ||
      email ||
      `${sub}@kid.user`
    ).toLowerCase();
    const finalEmailVerified =
      kidProfile?.email_verified ?? emailVerified ?? Boolean(kidProfile?.email || email);
    const finalPhone =
      kidProfile?.phone || kidProfile?.phone_number || kidProfile?.phoneNumber || phoneNumber || "";
    const finalPhoneVerified =
      kidProfile?.phone_number_verified ?? phoneVerified ?? false;
    const finalWallet =
      kidProfile?.wallet_address || kidProfile?.wallet?.address || walletAddress || "";
    const finalTelegramUsername =
      kidProfile?.telegram_username || telegramUsername || "";
    const finalTelegramId = kidProfile?.telegram_id
      ? String(kidProfile.telegram_id)
      : telegramId
      ? String(telegramId)
      : "";
    const finalPicture = kidProfile?.picture || picture || "";
    const finalPreferredUsername =
      kidProfile?.preferred_username || preferredUsername || "";

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

    if (user.status === "SUSPENDED") {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "ACCOUNT_SUSPENDED",
            message: "Your account has been suspended.",
          },
        },
        { status: 403 }
      );
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
      success: true,
      message: "KID Login successful",
      token,
      accessToken: token,
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
  } catch (error) {
    console.error("KID Login Route Error:", error);
    return NextResponse.json(
      { success: false, message: error.message || "Server error during KID login" },
      { status: 500 }
    );
  }
}
