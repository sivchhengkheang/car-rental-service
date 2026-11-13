import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Booking } from "@/models/Booking";
import { Car } from "@/models/Car";
import {
  acquireCarLock,
  getCarLock,
  invalidateCarCache,
} from "@/lib/redis";
import { authenticateRequest, authorizeRole } from "@/lib/auth";

export async function GET(req) {
  try {
    await connectDB();
    const auth = await authenticateRequest(req);
    if (auth.error) {
      return NextResponse.json({ success: false, message: auth.error }, { status: auth.status });
    }

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "10", 10);
    const skip = (page - 1) * limit;

    let filter = {};
    if (authorizeRole(auth.user, "ADMIN")) {
      if (status) filter.status = status;
    } else if (authorizeRole(auth.user, "HOST")) {
      const hostCars = await Car.find({ host: auth.user._id }).select("_id");
      filter.car = { $in: hostCars.map((c) => c._id) };
      if (status) filter.status = status;
    } else {
      filter.customer = auth.user._id;
      if (status) filter.status = status;
    }

    const total = await Booking.countDocuments(filter);
    const bookings = await Booking.find(filter)
      .populate("car")
      .populate("customer", "name email phoneNumber")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    return NextResponse.json({
      success: true,
      count: bookings.length,
      bookings,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error.message || "Failed to fetch bookings" },
      { status: 500 }
    );
  }
}

export async function POST(req) {
  try {
    await connectDB();
    const auth = await authenticateRequest(req);
    if (auth.error) {
      return NextResponse.json({ success: false, message: auth.error }, { status: auth.status });
    }

    const body = await req.json();
    const { carId, startDate, endDate } = body;
    const idempotencyKey = req.headers.get("idempotency-key") || body.idempotencyKey;

    if (!carId || !startDate || !endDate) {
      return NextResponse.json(
        { success: false, message: "Please provide carId, startDate, and endDate" },
        { status: 400 }
      );
    }

    if (idempotencyKey) {
      const existing = await Booking.findOne({
        customer: auth.user._id,
        idempotencyKey,
      }).populate("car");
      if (existing) {
        return NextResponse.json({
          success: true,
          message: "Returning existing booking",
          booking: existing,
          holdExpiresAt: existing.holdExpiresAt,
        });
      }
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start >= end) {
      return NextResponse.json(
        { success: false, message: "Invalid date range specified" },
        { status: 400 }
      );
    }

    const car = await Car.findOne({ _id: carId, isDeleted: { $ne: true } });
    if (!car) {
      return NextResponse.json({ success: false, message: "Car not found" }, { status: 404 });
    }

    if (!car.isAvailable || car.status !== "AVAILABLE") {
      return NextResponse.json(
        { success: false, message: "This car is currently unavailable for booking" },
        { status: 400 }
      );
    }

    // 1. Check Redis 15-Minute Reservation Lock
    const existingLock = await getCarLock(carId);
    if (
      existingLock &&
      existingLock.customerId &&
      String(existingLock.customerId) !== String(auth.user._id)
    ) {
      return NextResponse.json(
        {
          success: false,
          message: "This car is currently held by another customer at checkout.",
          heldUntil: existingLock.expiresAt,
        },
        { status: 409 }
      );
    }

    // 2. Check for date overlap
    const now = new Date();
    const overlapping = await Booking.findOne({
      car: carId,
      startDate: { $lt: end },
      endDate: { $gt: start },
      $or: [
        { status: { $in: ["PAID", "CONFIRMED", "ACTIVE"] } },
        {
          status: { $in: ["PROVISIONAL", "PENDING_PAYMENT"] },
          holdExpiresAt: { $gt: now },
          customer: { $ne: auth.user._id },
        },
      ],
    });

    if (overlapping) {
      return NextResponse.json(
        { success: false, message: "Car is already booked or held for those dates" },
        { status: 409 }
      );
    }

    const diffTime = Math.abs(end - start);
    const totalDays = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
    const totalPrice = totalDays * car.pricePerDay;
    const holdExpiresAt = new Date(Date.now() + 15 * 60 * 1000);

    // Cancel old pending holds by this user on this car
    await Booking.updateMany(
      {
        customer: auth.user._id,
        car: carId,
        status: { $in: ["PROVISIONAL", "PENDING_PAYMENT"] },
      },
      {
        status: "CANCELLED",
        cancellationReason: "Replaced by new reservation dates",
      }
    );

    const booking = await Booking.create({
      customer: auth.user._id,
      car: carId,
      startDate: start,
      endDate: end,
      totalDays,
      totalPrice,
      status: "PENDING_PAYMENT",
      paymentStatus: "PENDING",
      holdExpiresAt,
      idempotencyKey,
    });

    // 3. Atomically acquire Redis lock
    const lockResult = await acquireCarLock(carId, {
      bookingId: booking._id.toString(),
      customerId: auth.user._id.toString(),
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    });

    if (!lockResult.acquired && lockResult.heldByOther) {
      await Booking.findByIdAndDelete(booking._id);
      return NextResponse.json(
        { success: false, message: "Car was just held by another customer. Please choose another." },
        { status: 409 }
      );
    }

    await invalidateCarCache(carId);

    const populated = await Booking.findById(booking._id)
      .populate("car")
      .populate("customer", "name email phoneNumber");

    return NextResponse.json(
      {
        success: true,
        message: "Booking created and 15-minute checkout hold acquired",
        booking: populated,
        holdExpiresAt,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST /api/v1/bookings Error:", error);
    return NextResponse.json(
      { success: false, message: error.message || "Failed to create booking" },
      { status: 500 }
    );
  }
}
