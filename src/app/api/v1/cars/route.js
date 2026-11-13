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

export async function GET(req) {
  try {
    await connectDB();
    const { searchParams } = new URL(req.url);

    const start = searchParams.get("start");
    const end = searchParams.get("end");
    const brand = searchParams.get("brand");
    const category = searchParams.get("category");
    const minPrice = searchParams.get("minPrice");
    const maxPrice = searchParams.get("maxPrice");
    const city = searchParams.get("city");
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "20", 10);
    const sort = searchParams.get("sort") || "createdAt:desc";

    const filter = { isAvailable: true, isDeleted: { $ne: true } };

    if (brand) filter.brand = new RegExp(brand, "i");
    if (category) filter.category = category;

    if (minPrice || maxPrice) {
      filter.pricePerDay = {};
      if (minPrice) filter.pricePerDay.$gte = Number(minPrice);
      if (maxPrice) filter.pricePerDay.$lte = Number(maxPrice);
    }

    if (city) filter["location.city"] = new RegExp(city, "i");

    if (start && end) {
      const startDate = new Date(start);
      const endDate = new Date(end);

      if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
        const now = new Date();
        const overlappingBookings = await Booking.find({
          startDate: { $lt: endDate },
          endDate: { $gt: startDate },
          $or: [
            { status: { $in: ["PAID", "CONFIRMED", "ACTIVE"] } },
            {
              status: { $in: ["PROVISIONAL", "PENDING_PAYMENT"] },
              holdExpiresAt: { $gt: now },
            },
          ],
        }).select("car");

        const occupiedCarIds = overlappingBookings.map((b) => b.car);
        filter._id = { $nin: occupiedCarIds };
      }
    }

    let sortObj = { createdAt: -1 };
    if (sort) {
      const [field, direction] = String(sort).split(":");
      const dir = direction === "asc" ? 1 : -1;
      if (["pricePerDay", "year", "createdAt"].includes(field)) {
        sortObj = { [field]: dir };
      }
    }

    const skip = (page - 1) * limit;
    const total = await Car.countDocuments(filter);
    const cars = await Car.find(filter)
      .populate("host", "name email phoneNumber")
      .sort(sortObj)
      .skip(skip)
      .limit(limit);

    return NextResponse.json({
      success: true,
      count: cars.length,
      cars,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (error) {
    console.error("GET /api/v1/cars Error:", error);
    return NextResponse.json(
      { success: false, message: error.message || "Failed to fetch cars" },
      { status: 500 }
    );
  }
}

export async function POST(req) {
  try {
    await connectDB();
    const auth = await authenticateRequest(req);
    if (auth.error) {
      return NextResponse.json(
        { success: false, message: auth.error, code: auth.code },
        { status: auth.status }
      );
    }

    if (!authorizeRole(auth.user, "HOST", "ADMIN")) {
      return NextResponse.json(
        { success: false, message: "Forbidden: Host or Admin role required" },
        { status: 403 }
      );
    }

    const contentType = req.headers.get("content-type") || "";
    let bodyData = {};
    let uploadedPhotoUrls = [];

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
              uploadedPhotoUrls.push(uploaded.url);
              continue;
            } catch (storageErr) {
              console.error("[Cars] KOOMPI upload error:", storageErr.message);
            }
          }
        }
      }
    } else {
      bodyData = await req.json();
    }

    const {
      brand,
      modelName,
      year,
      licensePlate,
      category,
      seats,
      transmission,
      fuelType,
      pricePerDay,
      location,
      description,
      features,
    } = bodyData;

    if (!brand || !modelName || !year || !licensePlate || !pricePerDay) {
      return NextResponse.json(
        { success: false, message: "Missing required vehicle fields" },
        { status: 400 }
      );
    }

    let parsedLocation = {};
    if (typeof location === "string") {
      try {
        parsedLocation = JSON.parse(location);
      } catch {
        parsedLocation = { address: location };
      }
    } else if (location && typeof location === "object") {
      parsedLocation = location;
    }

    let parsedFeatures = [];
    if (typeof features === "string") {
      try {
        parsedFeatures = JSON.parse(features);
      } catch {
        parsedFeatures = features.split(",").map((f) => f.trim()).filter(Boolean);
      }
    } else if (Array.isArray(features)) {
      parsedFeatures = features;
    }

    let finalPhotos = [...uploadedPhotoUrls];
    if (bodyData.photos) {
      const existing = Array.isArray(bodyData.photos) ? bodyData.photos : [bodyData.photos];
      finalPhotos.push(...existing);
    }

    const newCar = await Car.create({
      host: auth.user._id,
      brand,
      modelName,
      year: Number(year),
      licensePlate: String(licensePlate).toUpperCase(),
      category: category || "Sedan",
      seats: seats ? Number(seats) : 5,
      transmission: transmission || "Automatic",
      fuelType: fuelType || "Gasoline",
      pricePerDay: Number(pricePerDay),
      photos: finalPhotos,
      location: parsedLocation,
      description: description || "",
      features: parsedFeatures,
      status: "AVAILABLE",
      isAvailable: true,
    });

    const populated = await Car.findById(newCar._id).populate("host", "name email phoneNumber");
    await invalidateCarCache();

    return NextResponse.json(
      {
        success: true,
        message: "Car listed successfully",
        car: populated,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST /api/v1/cars Error:", error);
    return NextResponse.json(
      { success: false, message: error.message || "Failed to create car" },
      { status: 500 }
    );
  }
}
