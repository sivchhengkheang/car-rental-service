import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Review } from "@/models/Review";
import { authenticateRequest } from "@/lib/auth";

export async function GET(req, { params }) {
  try {
    await connectDB();
    const { id } = await params;
    const { searchParams } = new URL(req.url);

    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "10", 10);
    const skip = (page - 1) * limit;

    const filter = { car: id };
    const total = await Review.countDocuments(filter);
    const reviews = await Review.find(filter)
      .populate("customer", "name email")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    return NextResponse.json({
      success: true,
      count: reviews.length,
      reviews,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error.message || "Failed to fetch reviews" },
      { status: 500 }
    );
  }
}
