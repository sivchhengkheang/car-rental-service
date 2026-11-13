import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Car } from "@/models/Car";

export async function POST(req) {
  try {
    await connectDB();
    const body = await req.json();
    const { carId, startDate, endDate } = body;

    if (!carId || !startDate || !endDate) {
      return NextResponse.json(
        { success: false, message: "Please provide carId, startDate, and endDate" },
        { status: 400 }
      );
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start >= end) {
      return NextResponse.json(
        { success: false, message: "Invalid date range" },
        { status: 400 }
      );
    }

    const car = await Car.findOne({ _id: carId, isDeleted: { $ne: true } });
    if (!car) {
      return NextResponse.json({ success: false, message: "Car not found" }, { status: 404 });
    }

    const diffTime = Math.abs(end - start);
    const totalDays = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
    const dailyRate = car.pricePerDay;
    const subtotal = totalDays * dailyRate;
    const deposit = 0;
    const totalPrice = subtotal + deposit;

    return NextResponse.json({
      success: true,
      quote: {
        car: {
          _id: car._id,
          brand: car.brand,
          modelName: car.modelName,
          category: car.category,
          pricePerDay: car.pricePerDay,
          photos: car.photos,
        },
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        totalDays,
        dailyRate,
        subtotal,
        deposit,
        totalPrice,
        currency: "USD",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error.message || "Failed to generate quote" },
      { status: 500 }
    );
  }
}
