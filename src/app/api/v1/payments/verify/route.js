import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Booking } from "@/models/Booking";
import { Payment } from "@/models/Payment";
import { releaseCarLock, invalidateCarCache } from "@/lib/redis";
import { authenticateRequest } from "@/lib/auth";

export async function POST(req) {
  try {
    await connectDB();
    const auth = await authenticateRequest(req);
    if (auth.error) {
      return NextResponse.json({ success: false, message: auth.error }, { status: auth.status });
    }

    const { bookingId } = await req.json();
    if (!bookingId) {
      return NextResponse.json({ success: false, message: "bookingId required" }, { status: 400 });
    }

    const booking = await Booking.findById(bookingId).populate("car");
    if (!booking) {
      return NextResponse.json({ success: false, message: "Booking not found" }, { status: 404 });
    }

    booking.status = "CONFIRMED";
    booking.paymentStatus = "PAID";
    await booking.save();

    await Payment.updateMany(
      { booking: booking._id },
      { status: "COMPLETED" }
    );

    if (booking.car) {
      const carId = booking.car._id.toString();
      await releaseCarLock(carId, booking._id.toString());
      await invalidateCarCache(carId);
    }

    return NextResponse.json({
      success: true,
      message: "Payment confirmed and booking activated",
      booking,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error.message || "Payment verification failed" },
      { status: 500 }
    );
  }
}
