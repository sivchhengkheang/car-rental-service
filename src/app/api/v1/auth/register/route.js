import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { connectDB } from "@/lib/db";
import { User } from "@/models/User";
import { signToken } from "@/lib/auth";

export async function POST(req) {
  try {
    await connectDB();
    const body = await req.json();
    const { name, email, password, phoneNumber, role, driverLicense } = body;

    if (!name || !email || !password || !phoneNumber) {
      return NextResponse.json(
        {
          success: false,
          message: "Please provide all required fields: name, email, password, and phoneNumber",
        },
        { status: 400 }
      );
    }

    if (role && String(role).toUpperCase() === "ADMIN") {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "ADMIN_REGISTRATION_FORBIDDEN",
            message: "Cannot register as ADMIN directly.",
          },
        },
        { status: 400 }
      );
    }

    const assignedRole = role && String(role).toUpperCase() === "HOST" ? "HOST" : "CUSTOMER";

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return NextResponse.json(
        { success: false, message: "An account with this email already exists" },
        { status: 400 }
      );
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = await User.create({
      name,
      email: email.toLowerCase(),
      password: hashedPassword,
      phoneNumber,
      role: assignedRole,
      status: "ACTIVE",
      driverLicense: driverLicense || {},
    });

    const accessToken = signToken({ id: newUser._id, role: newUser.role }, { expiresIn: "15m" });
    const refreshToken = signToken({ id: newUser._id }, { expiresIn: "7d" });

    newUser.refreshToken = refreshToken;
    await newUser.save();

    const formattedUser = {
      _id: newUser._id,
      name: newUser.name,
      email: newUser.email,
      role: newUser.role,
      status: newUser.status,
      phoneNumber: newUser.phoneNumber,
      driverLicense: newUser.driverLicense,
    };

    const res = NextResponse.json(
      {
        success: true,
        message: "User registered successfully",
        accessToken,
        refreshToken,
        token: accessToken,
        user: formattedUser,
      },
      { status: 201 }
    );

    res.cookies.set("token", accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60,
      path: "/",
    });

    return res;
  } catch (error) {
    console.error("Register route error:", error);
    return NextResponse.json(
      { success: false, message: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
