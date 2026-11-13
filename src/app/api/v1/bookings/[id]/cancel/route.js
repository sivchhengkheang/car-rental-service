import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Booking } from "@/models/Booking";
import { releaseCarLock, invalidateCarCache } from "@/lib/redis";
import { authenticateRequest, authorizeRole } from "@/lib/auth";

export async function PATCH(req, { params }) {
  try {
    await connectDB();
    const { id } = await params;

    const auth = await authenticateRequest(req);
    if (auth.error) {
      return NextResponse.json({ success: false, message: auth.error }, { status: auth.status });
    }

    const body = await req.json().catch(() => ({}));
    const { reason } = body;

    const booking = await Booking.findById(id).populate("car");
    if (!booking) {
      return NextResponse.json({ success: false, message: "Booking not found" }, { status: 404 });
    }

    const isCustomer = String(booking.customer) === String(auth.user._id);
    const isHost =
      booking.car &&
      booking.car.host &&
      String(booking.car.host) === String(auth.user._id);
    const isAdmin = authorizeRole(auth.user, "ADMIN");

    if (!isCustomer && !isHost && !isAdmin) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 403 });
    }

    booking.status = "CANCELLED";
    if (reason) booking.cancellationReason = reason;
    await booking.save();

    if (booking.car) {
      const carId = booking.car._id.toString();
      await releaseCarLock(carId, booking._id.toString());
      await invalidateCarCache(carId);
    }

    return NextResponse.json({
      success: true,
      message: "Booking cancelled and reservation hold released",
      booking,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error.message || "Failed to cancel booking" },
      { status: 500 }
    );
  }
}
