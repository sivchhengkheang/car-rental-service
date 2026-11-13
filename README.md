# Car Rental Service — Unified Full-Stack Application

Unified Full-Stack Car Rental Application built with **Next.js 16 (App Router)**, **MongoDB (Mongoose)**, **Upstash Redis**, **KOOMPI Cloud Object Storage**, and **Baray Payment Gateway**.

Both the frontend React pages and backend REST API route handlers (`/api/v1/...`) live inside this single codebase, eliminating CORS restrictions and separate backend server requirements.

---

## Architecture & Features

- **Frontend & Backend in One**: No separate Express server required. Next.js App Router serves UI pages and API route handlers simultaneously.
- **KOOMPI Cloud Object Storage**: Direct photo uploads to Cloudflare R2 bucket with permanent public CDN URLs (`https://storage.koompi.cloud/...`).
- **Atomic 15-Minute Checkout Hold**: Upstash Redis lock (`SET lock:car:... NX EX 900`) prevents double booking during checkout.
- **Baray Payment Gateway**: AES-256-CBC KHQR payment encryption and instant verification.
- **Authentication**: JWT authentication with cookies + KOOMPI ID (KID) Single Sign-On.

---

## Directory Structure

```text
car-rental-service/
├── src/
│   ├── app/
│   │   ├── (marketplace)/             # UI: Home, /booking (CDP), /checkout, /compare, /basket
│   │   ├── auth/                      # UI: /auth/login, /auth/register, /auth/kid/callback
│   │   ├── dashboard/                 # UI: /dashboard (admin stats, host fleet, bookings, users)
│   │   └── api/v1/                    # Backend Route Handlers:
│   │       ├── health/route.js        # GET health status
│   │       ├── auth/                  # login, register, me, logout, kid
│   │       ├── cars/                  # search/filter, detail, CRUD, KOOMPI image upload
│   │       ├── bookings/              # quote, create with 15-min lock, cancel, my
│   │       ├── payments/              # checkout intent, verify, booking lookup
│   │       └── admin/                 # platform statistics
│   ├── components/                    # UI Components (CarCard, MapExplorer, Lightbox, etc.)
│   ├── lib/
│   │   ├── db.js                      # Cached Mongoose connection (hot-reload safe)
│   │   ├── redis.js                   # Upstash Redis client (cache & 15-min checkout locks)
│   │   └── auth.js                    # JWT & KID OAuth token validation
│   ├── models/                        # Mongoose Models: User, Car, Booking, Review, Payment
│   └── services/
│       ├── koompiStorageService.js    # KOOMPI Cloud Object Storage client
│       ├── barayService.js            # Baray AES-256-CBC payment encryption
│       └── bookingCleanupService.js   # 15-minute hold auto-cleanup
├── .env.local                         # Single unified environment configuration
└── package.json
```

---

## Quick Start

```bash
cd car-rental-service

# Install dependencies (already installed)
npm install

# Start unified application (runs on http://localhost:3000)
npm run dev
```

---

## Environment Configuration (`.env.local`)

```env
# MongoDB Database
MONGO_URI=mongodb+srv://...

# Security
JWT_SECRET=supersecret_car_booking_jwt_key_2026

# Redis Cache
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...

# Baray Payment Gateway
BARAY_API_KEY=...
BARAY_SK=...
BARAY_IV=...

# KOOMPI Cloud Object Storage
KOOMPI_STORAGE_BASE_URL=https://api-kconsole.koompi.cloud
KOOMPI_STORAGE_API_KEY=sk_...

# KID OAuth Single Sign-On
NEXT_PUBLIC_KID_CLIENT_ID=...
NEXT_PUBLIC_KID_REDIRECT_URI=http://localhost:3000/auth/kid/callback
KID_CLIENT_ID=...
KID_CLIENT_SECRET=...
KID_REDIRECT_URI=http://localhost:3000/auth/kid/callback
KID_BASE_URL=https://api.kid.koompi.org
```
