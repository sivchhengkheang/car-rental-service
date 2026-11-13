import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Booking } from "@/models/Booking";
import { Payment } from "@/models/Payment";
import {
  acquireCarLock,
  releaseCarLock,
  invalidateCarCache,
} from "@/lib/redis";
import { encryptPayload } from "@/services/barayService";
import { authenticateRequest } from "@/lib/auth";

export async function POST(req) {
  try {
    await connectDB();
    const auth = await authenticateRequest(req);
    if (auth.error) {
      return NextResponse.json({ success: false, message: auth.error }, { status: auth.status });
    }

    const rawBody = await req.json().catch(() => ({}));
    const bookingId =
      rawBody.bookingId ||
      rawBody.booking_id ||
      rawBody.id ||
      rawBody.booking?._id;

    if (!bookingId) {
      return NextResponse.json(
        { success: false, message: "Please provide a valid bookingId" },
        { status: 400 }
      );
    }

    const booking = await Booking.findById(bookingId)
      .populate("car")
      .populate("customer");

    if (!booking) {
      return NextResponse.json({ success: false, message: "Booking not found" }, { status: 404 });
    }

    const isCustomer = String(booking.customer?._id) === String(auth.user._id);
    const isAdmin = auth.user.role === "ADMIN";
    if (!isCustomer && !isAdmin) {
      return NextResponse.json(
        { success: false, message: "Unauthorized for this booking" },
        { status: 403 }
      );
    }

    if (booking.paymentStatus === "PAID" || booking.status === "PAID") {
      return NextResponse.json(
        { success: false, message: "Booking has already been paid" },
        { status: 400 }
      );
    }

    if (booking.status === "CANCELLED") {
      return NextResponse.json(
        { success: false, message: "Booking has been cancelled" },
        { status: 400 }
      );
    }

    const carId = booking.car?._id?.toString() || booking.car?.toString();
    if (
      booking.holdExpiresAt &&
      new Date() > new Date(booking.holdExpiresAt) &&
      booking.paymentStatus !== "PAID"
    ) {
      if (carId) {
        await releaseCarLock(carId);
        await invalidateCarCache(carId);
      }
      await Payment.deleteMany({ booking: booking._id, status: { $ne: "COMPLETED" } });
      await Booking.findByIdAndDelete(booking._id);

      return NextResponse.json(
        { success: false, message: "15-minute checkout hold expired. Please re-book." },
        { status: 409 }
      );
    }

    if (carId) {
      const lockResult = await acquireCarLock(carId, {
        bookingId: booking._id.toString(),
        customerId: auth.user._id.toString(),
        startDate: booking.startDate?.toISOString(),
        endDate: booking.endDate?.toISOString(),
      });

      if (!lockResult.acquired && lockResult.heldByOther) {
        return NextResponse.json(
          { success: false, message: "Car is held by another customer." },
          { status: 409 }
        );
      }
    }

    const priceNum = Number(booking.totalPrice);
    const orderId = `ORDER-${booking._id}-${Date.now()}`;
    const carBrand = booking.car?.brand || "Car";
    const carModel = booking.car?.modelName || "Rental";
    const carName = `${carBrand} ${carModel}`.trim();

    const hostOrigin = req.headers.get("origin") || "http://localhost:3000";
    const successUrl = `${hostOrigin}/booking/success?bookingId=${booking._id}&paid=true`;
    const cancelUrl = `${hostOrigin}/booking/checkout?bookingId=${booking._id}&paymentStatus=cancelled`;

    const payload = {
      amount: priceNum.toFixed(2),
      currency: "USD",
      order_id: orderId,
      tracking: {
        customer_id: auth.user._id.toString(),
        booking_id: booking._id.toString(),
        car: carName,
      },
      order_details: {
        items: [
          {
            name: `${carName} — ${booking.totalDays || 1} day(s)`,
            price: priceNum,
          },
        ],
      },
      custom_success_url: successUrl,
      custom_cancel_url: cancelUrl,
      cancel_url: cancelUrl,
    };

    const encryptedData = encryptPayload(payload);

    const barayResponse = await fetch("https://api.baray.io/pay", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.BARAY_API_KEY,
      },
      body: JSON.stringify({ data: encryptedData }),
    });

    if (!barayResponse.ok) {
      const errorBody = await barayResponse.json().catch(() => ({}));
      return NextResponse.json(
        { success: false, message: errorBody.error || "Failed to create Baray intent" },
        { status: 502 }
      );
    }

    const intent = await barayResponse.json();
    const paymentUrl = `https://pay.baray.io/${intent._id}`;

    booking.holdExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
    booking.paymentDetails = {
      barayIntentId: intent._id,
      barayOrderId: orderId,
      barayPaymentUrl: paymentUrl,
      paymentMethod: "KHQR",
    };
    await booking.save();

    const paymentRecord = await Payment.create({
      booking: booking._id,
      user: auth.user._id,
      amount: priceNum,
      currency: "USD",
      status: "PENDING",
      paymentMethod: "KHQR",
      barayOrderId: orderId,
      barayIntentId: intent._id,
    });

    return NextResponse.json({
      success: true,
      data: {
        paymentId: paymentRecord._id,
        bookingId: booking._id,
        orderId,
        paymentUrl,
        intent,
      },
      paymentUrl,
    });
  } catch (error) {
    console.error("Payment checkout error:", error);
    return NextResponse.json(
      { success: false, message: error.message || "Payment intent error" },
      { status: 500 }
    );
  }
}
