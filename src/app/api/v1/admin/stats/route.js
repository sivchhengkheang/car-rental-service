import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { User } from "@/models/User";
import { Car } from "@/models/Car";
import { Booking } from "@/models/Booking";
import { Payment } from "@/models/Payment";
import { authenticateRequest, authorizeRole } from "@/lib/auth";

export async function GET(req) {
  try {
    await connectDB();
    const auth = await authenticateRequest(req);
    if (auth.error) {
      return NextResponse.json({ success: false, message: auth.error }, { status: auth.status });
    }

    if (!authorizeRole(auth.user, "ADMIN")) {
      return NextResponse.json({ success: false, message: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    const [
      totalUsers,
      totalCustomers,
      totalHosts,
      totalCars,
      activeCars,
      bookingStatusCounts,
      revenueData,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ role: "CUSTOMER" }),
      User.countDocuments({ role: "HOST" }),
      Car.countDocuments({ isDeleted: { $ne: true } }),
      Car.countDocuments({ isAvailable: true, status: "AVAILABLE", isDeleted: { $ne: true } }),
      Booking.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      Payment.aggregate([
        { $match: { status: { $in: ["COMPLETED", "SUCCESS", "PAID"] } } },
        { $group: { _id: null, totalRevenue: { $sum: "$amount" } } },
      ]),
    ]);

    const bookingsByStatus = {};
    bookingStatusCounts.forEach((item) => {
      bookingsByStatus[item._id] = item.count;
    });

    let periodRevenue = null;
    if (from || to) {
      const matchCriteria = { status: { $in: ["COMPLETED", "SUCCESS", "PAID"] }, createdAt: {} };
      if (from) matchCriteria.createdAt.$gte = new Date(from);
      if (to) matchCriteria.createdAt.$lte = new Date(to);

      const periodAgg = await Payment.aggregate([
        { $match: matchCriteria },
        { $group: { _id: null, revenue: { $sum: "$amount" } } },
      ]);
      periodRevenue = periodAgg.length > 0 ? periodAgg[0].revenue : 0;
    }

    return NextResponse.json({
      success: true,
      stats: {
        users: {
          total: totalUsers,
          customers: totalCustomers,
          hosts: totalHosts,
        },
        cars: {
          total: totalCars,
          activeAvailable: activeCars,
        },
        bookings: bookingsByStatus,
        revenue: {
          allTime: revenueData.length > 0 ? revenueData[0].totalRevenue : 0,
          periodRevenue,
          currency: "USD",
        },
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error.message || "Failed to calculate stats" },
      { status: 500 }
    );
  }
}
