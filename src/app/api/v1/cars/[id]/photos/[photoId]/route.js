import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Car } from "@/models/Car";
import { invalidateCarCache } from "@/lib/redis";
import { deleteFileFromKoompi } from "@/services/koompiStorageService";
import { authenticateRequest, authorizeRole } from "@/lib/auth";

export async function DELETE(req, { params }) {
  try {
    await connectDB();
    const { id, photoId } = await params;

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
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 403 });
    }

    const decodedTarget = decodeURIComponent(photoId);
    let removedPhotos = [];
    const photoIndex = Number(photoId);

    if (!isNaN(photoIndex) && photoIndex >= 0 && photoIndex < car.photos.length) {
      removedPhotos = car.photos.splice(photoIndex, 1);
    } else {
      removedPhotos = car.photos.filter((p) => p.includes(decodedTarget));
      car.photos = car.photos.filter((p) => !p.includes(decodedTarget));
    }

    for (const photo of removedPhotos) {
      deleteFileFromKoompi(photo).catch(() => {});
    }

    await car.save();
    await invalidateCarCache(car._id.toString());

    return NextResponse.json({
      success: true,
      message: "Photo deleted successfully",
      photos: car.photos,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error.message || "Failed to delete photo" },
      { status: 500 }
    );
  }
}
