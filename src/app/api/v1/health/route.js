import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { redisClient } from "@/lib/redis";
import mongoose from "mongoose";

export async function GET() {
  try {
    await connectDB();
    const isDbConnected = mongoose.connection.readyState === 1;
    const isRedisConnected = Boolean(redisClient?.isReady);

    return NextResponse.json({
      success: true,
      status: "HEALTHY",
      timestamp: new Date().toISOString(),
      version: "2.0.0 (Unified Full-Stack)",
      services: {
        database: {
          status: isDbConnected ? "CONNECTED" : "DISCONNECTED",
        },
        cache: {
          status: isRedisConnected ? "CONNECTED" : "DISCONNECTED",
        },
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        status: "UNHEALTHY",
        error: error.message,
      },
      { status: 500 }
    );
  }
}
