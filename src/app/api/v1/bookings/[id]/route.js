import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Booking } from "@/models/Booking";
import { Payment } from "@/models/Payment";
import { releaseCarLock, invalidateCarCache } from "@/lib/redis";
import { authenticateRequest, authorizeRole } from "@/lib/auth";

export async function GET(req, { params }) {
  try {
    await connectDB();
    const { id } = await params;

    const auth = await authenticateRequest(req);
    if (auth.error) {
      return NextResponse.json({ success: false, message: auth.error }, { status: auth.status });
    }

    const booking = await Booking.findById(id)
      .populate({
        path: "car",
        populate: { path: "host", select: "name email phoneNumber" },
      })
      .populate("customer", "name email phoneNumber driverLicense");

    if (!booking) {
      return NextResponse.json({ success: false, message: "Booking not found" }, { status: 404 });
    }

    const isCustomer = String(booking.customer?._id) === String(auth.user._id);
    const isHost =
      booking.car &&
      booking.car.host &&
      String(booking.car.host._id) === String(auth.user._id);
    const isAdmin = authorizeRole(auth.user, "ADMIN");

    if (!isCustomer && !isHost && !isAdmin) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 403 });
    }

    // Check if 15-minute checkout hold expired
    if (
      booking.status === "PENDING_PAYMENT" &&
      booking.paymentStatus !== "PAID" &&
      booking.holdExpiresAt &&
      new Date() > new Date(booking.holdExpiresAt)
    ) {
      const carId = booking.car?._id ? booking.car._id.toString() : booking.car?.toString();
      if (carId) {
        await releaseCarLock(carId);
        await invalidateCarCache(carId);
      }
      await Payment.deleteMany({ booking: booking._id, status: { $ne: "COMPLETED" } });
      await Booking.findByIdAndDelete(booking._id);

      return NextResponse.json(
        {
          success: false,
          message: "Reservation hold expired",
          expired: true,
        },
        { status: 410 }
      );
    }

    return NextResponse.json({ success: true, booking });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error.message || "Failed to fetch booking" },
      { status: 500 }
    );
  }
}
