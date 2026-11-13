import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Payment } from "@/models/Payment";
import { Booking } from "@/models/Booking";
import { authenticateRequest } from "@/lib/auth";

export async function GET(req, { params }) {
  try {
    await connectDB();
    const { bookingId } = await params;

    const auth = await authenticateRequest(req);
    if (auth.error) {
      return NextResponse.json({ success: false, message: auth.error }, { status: auth.status });
    }

    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return NextResponse.json({ success: false, message: "Booking not found" }, { status: 404 });
    }

    const payment = await Payment.findOne({ booking: bookingId }).sort({ createdAt: -1 });

    return NextResponse.json({
      success: true,
      payment: payment || null,
      booking,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error.message || "Failed to fetch payment" },
      { status: 500 }
    );
  }
}
