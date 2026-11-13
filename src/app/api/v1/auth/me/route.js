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
        role: user.role,
        status: user.status || "ACTIVE",
        sub: user.sub || null,
        kid: user.kid || null,
        walletAddress: user.walletAddress || null,
        phoneNumber: user.phoneNumber,
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
