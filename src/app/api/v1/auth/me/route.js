import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";

export async function GET(req) {
  try {
    const auth = await authenticateRequest(req);
    if (auth.error) {
      return NextResponse.json(
        { success: false, message: auth.error, code: auth.code },
        { status: auth.status }
      );
    }

    const user = auth.user;
    return NextResponse.json({
      success: true,
      user: {
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
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error.message || "Server error" },
      { status: 500 }
    );
  }
}
