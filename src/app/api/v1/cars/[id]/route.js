import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Car } from "@/models/Car";
import { Booking } from "@/models/Booking";
import {
  getCache,
  setCache,
  invalidateCarCache,
  CACHE_TTL,
} from "@/lib/redis";
import {
  isKoompiStorageConfigured,
  uploadFileToKoompi,
} from "@/services/koompiStorageService";
import { authenticateRequest, authorizeRole } from "@/lib/auth";

export async function GET(req, { params }) {
  try {
    await connectDB();
    const { id } = await params;

    const cacheKey = `cars:detail:${id}`;
    const cached = await getCache(cacheKey);
    if (cached) {
      return NextResponse.json({ success: true, car: cached });
    }

    const car = await Car.findOne({ _id: id, isDeleted: { $ne: true } }).populate(
      "host",
      "name email phoneNumber"
    );

    if (!car) {
      return NextResponse.json({ success: false, message: "Car not found" }, { status: 404 });
    }

    await setCache(cacheKey, car, CACHE_TTL.CAR_DETAILS);
    return NextResponse.json({ success: true, car });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error.message || "Failed to fetch car" },
      { status: 500 }
    );
  }
}

export async function PUT(req, { params }) {
  try {
    await connectDB();
    const { id } = await params;

    const auth = await authenticateRequest(req);
    if (auth.error) {
      return NextResponse.json({ success: false, message: auth.error }, { status: auth.status });
    }

    const car = await Car.findById(id);
    if (!car || car.isDeleted) {
      return NextResponse.json({ success: false, message: "Car not found" }, { status: 404 });
    }

    const isOwner = car.host && car.host.toString() === auth.user._id.toString();
    const isAdmin = authorizeRole(auth.user, "ADMIN");
    if (!isOwner && !isAdmin) {
      return NextResponse.json(
        { success: false, message: "Not authorized to modify this car" },
        { status: 403 }
      );
    }

    const contentType = req.headers.get("content-type") || "";
    let bodyData = {};
    let newPhotos = [];

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      for (const [key, value] of formData.entries()) {
        if (key !== "photos") {
          bodyData[key] = value;
        }
      }
      const files = formData.getAll("photos");
      for (const file of files) {
        if (file && typeof file.arrayBuffer === "function" && file.size > 0) {
          const buffer = Buffer.from(await file.arrayBuffer());
          if (isKoompiStorageConfigured()) {
            try {
              const uploaded = await uploadFileToKoompi({
                buffer,
                originalname: file.name,
                mimetype: file.type,
                size: file.size,
                path: "cars",
              });
              newPhotos.push(uploaded.url);
            } catch (err) {
              console.error("[Cars] KOOMPI upload error:", err.message);
            }
          }
        }
      }
    } else {
      bodyData = await req.json();
    }

    const fields = [
      "brand",
      "modelName",
      "year",
      "licensePlate",
      "category",
      "seats",
      "transmission",
      "fuelType",
      "pricePerDay",
      "description",
      "status",
      "isAvailable",
    ];

    fields.forEach((field) => {
      if (bodyData[field] !== undefined) {
        if (["year", "seats", "pricePerDay"].includes(field)) {
          car[field] = Number(bodyData[field]);
        } else if (field === "isAvailable") {
          car[field] = bodyData[field] === true || bodyData[field] === "true";
        } else {
          car[field] = bodyData[field];
        }
      }
    });

    if (bodyData.location) {
      let loc = bodyData.location;
      if (typeof loc === "string") {
        try {
          loc = JSON.parse(loc);
        } catch {
          loc = { address: loc };
        }
      }
      car.location = loc;
    }

    if (bodyData.features) {
      let feat = bodyData.features;
      if (typeof feat === "string") {
        try {
          feat = JSON.parse(feat);
        } catch {
          feat = feat.split(",").map((f) => f.trim()).filter(Boolean);
        }
      }
      car.features = feat;
    }

    if (bodyData.photos !== undefined) {
      let specified = [];
      if (typeof bodyData.photos === "string") {
        try {
          specified = JSON.parse(bodyData.photos);
        } catch {
          specified = [bodyData.photos];
        }
      } else if (Array.isArray(bodyData.photos)) {
        specified = bodyData.photos;
      }
      car.photos = [...specified, ...newPhotos];
    } else if (newPhotos.length > 0) {
      car.photos = [...car.photos, ...newPhotos];
    }

    await car.save();
    await invalidateCarCache(car._id.toString());

    const updated = await Car.findById(car._id).populate("host", "name email phoneNumber");
    return NextResponse.json({
      success: true,
      message: "Car updated successfully",
      car: updated,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error.message || "Failed to update car" },
      { status: 500 }
    );
  }
}

export async function PATCH(req, ctx) {
  return PUT(req, ctx);
}

export async function DELETE(req, { params }) {
  try {
    await connectDB();
    const { id } = await params;

    const auth = await authenticateRequest(req);
    if (auth.error) {
      return NextResponse.json({ success: false, message: auth.error }, { status: auth.status });
    }

    const car = await Car.findById(id);
    if (!car || car.isDeleted) {
      return NextResponse.json({ success: false, message: "Car not found" }, { status: 404 });
    }

    const isOwner = car.host && car.host.toString() === auth.user._id.toString();
    const isAdmin = authorizeRole(auth.user, "ADMIN");
    if (!isOwner && !isAdmin) {
      return NextResponse.json(
        { success: false, message: "Not authorized to delete this vehicle listing" },
        { status: 403 }
      );
    }

    // Check active bookings
    const now = new Date();
    const activeBookings = await Booking.find({
      car: car._id,
      endDate: { $gte: now },
      status: { $in: ["CONFIRMED", "ACTIVE", "PAID"] },
    });

    if (activeBookings.length > 0) {
      return NextResponse.json(
        {
          success: false,
          message: "Cannot delete vehicle with active or upcoming reservations",
        },
        { status: 400 }
      );
    }

    car.isDeleted = true;
    car.isAvailable = false;
    car.status = "UNAVAILABLE";
    await car.save();
    await invalidateCarCache(car._id.toString());

    return NextResponse.json({
      success: true,
      message: "Car listing deleted successfully",
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error.message || "Failed to delete car" },
      { status: 500 }
    );
  }
}
