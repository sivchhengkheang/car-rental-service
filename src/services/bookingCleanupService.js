import { Booking } from "../models/Booking.js";
import { Payment } from "../models/Payment.js";
import { releaseCarLock, invalidateCarCache } from "../lib/redis.js";

/**
 * Sweeps and deletes any booking that has been in PENDING_PAYMENT or PROVISIONAL
 * status longer than its 15-minute hold (holdExpiresAt <= now).
 */
export const cleanupExpiredBookings = async () => {
  try {
    const now = new Date();

    const expiredBookings = await Booking.find({
      status: { $in: ["PENDING_PAYMENT", "PROVISIONAL"] },
      paymentStatus: { $ne: "PAID" },
      holdExpiresAt: { $lte: now },
    });

    if (!expiredBookings || expiredBookings.length === 0) {
      return 0;
    }

    console.log(
      `[BookingCleanup] Found ${expiredBookings.length} expired pending booking(s) to remove`
    );

    for (const booking of expiredBookings) {
      const carId = booking.car?._id
        ? booking.car._id.toString()
        : booking.car?.toString();

      if (carId) {
        try {
          await releaseCarLock(carId);
          await invalidateCarCache(carId);
        } catch (lockErr) {
          console.warn(
            `[BookingCleanup] Failed to release Redis lock/cache for car ${carId}:`,
            lockErr.message
          );
        }
      }

      try {
        await Payment.deleteMany({
          booking: booking._id,
          status: { $ne: "COMPLETED" },
        });
      } catch (payErr) {
        console.warn(
          `[BookingCleanup] Failed to clean up payments for booking ${booking._id}:`,
          payErr.message
        );
      }

      await Booking.findByIdAndDelete(booking._id);
    }

    return expiredBookings.length;
  } catch (error) {
    console.error("[BookingCleanup] Error during expiration cleanup:", error.message);
    return 0;
  }
};
