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
      phoneNumber,
      walletAddress,
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
    const finalName = kidProfile?.name || name || (finalKid ? `KID User #${finalKid}` : "KID Customer");
    const finalEmail = (kidProfile?.email || email || `${sub}@kid.user`).toLowerCase();
    const finalPhone = kidProfile?.phone || kidProfile?.phoneNumber || phoneNumber || "";
    const finalWallet = kidProfile?.wallet?.address || walletAddress || "";

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
      role: user.role,
      status: user.status || "ACTIVE",
      sub: user.sub || null,
      kid: user.kid || null,
      walletAddress: user.walletAddress || null,
      phoneNumber: user.phoneNumber,
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
