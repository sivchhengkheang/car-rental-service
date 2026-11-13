import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Booking } from "@/models/Booking";
import { getCache, setCache, getCarLock, CACHE_TTL } from "@/lib/redis";

export async function GET(req, { params }) {
  try {
    await connectDB();
    const { id } = await params;
    const cacheKey = `cars:booked:${id}`;

    const cachedData = await getCache(cacheKey);
    if (cachedData) {
      return NextResponse.json(cachedData);
    }

    const now = new Date();
    const bookings = await Booking.find({
      car: id,
      endDate: { $gte: now },
      $or: [
        { status: { $in: ["PAID", "CONFIRMED", "ACTIVE"] } },
        {
          status: { $in: ["PROVISIONAL", "PENDING_PAYMENT"] },
          holdExpiresAt: { $gt: now },
        },
      ],
    }).select("startDate endDate customer status holdExpiresAt");

    const activeLock = await getCarLock(id);

    const responseData = {
      success: true,
      bookedDates: bookings,
      activeHold: activeLock
        ? {
            isHeld: true,
            expiresAt: activeLock.expiresAt,
            customerId: activeLock.customerId || null,
          }
        : null,
    };

    await setCache(cacheKey, responseData, CACHE_TTL.BOOKED_DATES);
    return NextResponse.json(responseData);
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error.message || "Failed to fetch booked dates" },
      { status: 500 }
    );
  }
}
