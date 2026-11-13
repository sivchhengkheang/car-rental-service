import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Car } from "@/models/Car";
import { authenticateRequest, authorizeRole } from "@/lib/auth";

export async function GET(req) {
  try {
    await connectDB();
    const auth = await authenticateRequest(req);
    if (auth.error) {
      return NextResponse.json({ success: false, message: auth.error }, { status: auth.status });
    }

    if (!authorizeRole(auth.user, "HOST", "ADMIN")) {
      return NextResponse.json({ success: false, message: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "10", 10);
    const skip = (page - 1) * limit;

    const filter = { host: auth.user._id, isDeleted: { $ne: true } };
    const total = await Car.countDocuments(filter);
    const cars = await Car.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit);

    return NextResponse.json({
      success: true,
      count: cars.length,
      cars,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error.message || "Failed to fetch host cars" },
      { status: 500 }
    );
  }
}
