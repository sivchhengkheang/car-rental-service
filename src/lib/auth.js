import jwt from "jsonwebtoken";
import { connectDB } from "./db.js";
import { User } from "../models/User.js";

const kidTokenCache = new Map();

export async function verifyKidOAuthToken(token) {
  if (!token || typeof token !== "string") return null;

  const cached = kidTokenCache.get(token);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.user;
  }

  try {
    const kidBaseUrl = process.env.KID_BASE_URL || "https://api.kid.koompi.org";
    const userinfoUrl = `${kidBaseUrl.replace(/\/+$/, "")}/oauth/userinfo`;

    const response = await fetch(userinfoUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) return null;

    const data = await response.json();
    const user = data.user || data;

    if (user && user.sub) {
      kidTokenCache.set(token, {
        user,
        expiresAt: Date.now() + 5 * 60 * 1000,
      });
      return user;
    }
    return null;
  } catch (err) {
    console.warn("KID token verification error:", err.message);
    return null;
  }
}

/**
 * Extract token from Request (Authorization header or Cookie)
 */
export function extractToken(req) {
  let token = null;

  const authHeader = req.headers.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.split(" ")[1];
  } else if (req.cookies && typeof req.cookies.get === "function") {
    token = req.cookies.get("token")?.value;
  } else {
    // If raw cookie string
    const cookieHeader = req.headers.get("cookie");
    if (cookieHeader) {
      const match = cookieHeader.match(/(?:^|;\s*)token=([^;]+)/);
      if (match) token = match[1];
    }
  }

  return token;
}

/**
 * Verify authentication in a Next.js Route Handler.
 * Returns { user } or { error, status, code }
 */
export async function authenticateRequest(req) {
  await connectDB();
  const token = extractToken(req);

  if (!token) {
    return {
      error: "Not authorized, no token provided",
      status: 401,
      code: "NO_TOKEN",
    };
  }

  // 1. Try standard JWT
  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "supersecret_car_booking_jwt_key_2026"
    );

    const user = await User.findById(decoded.id);
    if (!user) {
      return {
        error: "Not authorized, user not found",
        status: 401,
        code: "USER_NOT_FOUND",
      };
    }

    if (user.status === "SUSPENDED") {
      return {
        error: "Your account has been suspended. Please contact support.",
        status: 403,
        code: "ACCOUNT_SUSPENDED",
      };
    }

    return { user };
  } catch (jwtError) {
    // 2. Try KID OAuth token
    try {
      const kidUser = await verifyKidOAuthToken(token);
      if (kidUser && kidUser.sub) {
        let user = await User.findOne({ sub: kidUser.sub });

        if (!user && kidUser.email) {
          user = await User.findOne({ email: kidUser.email.toLowerCase() });
          if (user) {
            user.sub = kidUser.sub;
            if (kidUser.kid) user.kid = kidUser.kid;
            if (kidUser.wallet?.address) user.walletAddress = kidUser.wallet.address;
            await user.save();
          }
        }

        if (!user) {
          user = await User.create({
            sub: kidUser.sub,
            kid: kidUser.kid || "",
            walletAddress: kidUser.wallet?.address || "",
            name: kidUser.name || (kidUser.kid ? `KID User #${kidUser.kid}` : "KID Customer"),
            email: (kidUser.email || `${kidUser.sub}@kid.user`).toLowerCase(),
            phoneNumber: kidUser.phone || kidUser.phoneNumber || "",
            role: "CUSTOMER",
            status: "ACTIVE",
          });
        }

        if (user.status === "SUSPENDED") {
          return {
            error: "Your account has been suspended. Please contact support.",
            status: 403,
            code: "ACCOUNT_SUSPENDED",
          };
        }

        return { user };
      }
    } catch {
      // Failed KID token
    }

    const isExpired = jwtError?.name === "TokenExpiredError";
    return {
      error: isExpired
        ? "Token has expired. Please refresh your token."
        : "Not authorized, token failed or invalid",
      status: 401,
      code: isExpired ? "TOKEN_EXPIRED" : "INVALID_TOKEN",
    };
  }
}

export function authorizeRole(user, ...roles) {
  if (!user) return false;
  const userRole = user.role?.toUpperCase();
  const normalized = roles.map((r) => r.toUpperCase());
  return normalized.includes(userRole);
}

export function signToken(payload, options = { expiresIn: "7d" }) {
  return jwt.sign(
    payload,
    process.env.JWT_SECRET || "supersecret_car_booking_jwt_key_2026",
    options
  );
}
