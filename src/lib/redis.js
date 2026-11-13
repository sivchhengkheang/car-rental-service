import { createClient } from "redis";

let redisUrl = process.env.REDIS_URL;

if (!redisUrl && process.env.UPSTASH_REDIS_REST_URL) {
  try {
    const parsed = new URL(process.env.UPSTASH_REDIS_REST_URL);
    const token = process.env.UPSTASH_REDIS_REST_TOKEN || "";
    if (parsed.protocol === "https:" && token) {
      redisUrl = `rediss://default:${token}@${parsed.hostname}:6379`;
    } else {
      redisUrl = process.env.UPSTASH_REDIS_REST_URL;
    }
  } catch (err) {
    redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  }
}

if (!redisUrl) {
  redisUrl = "redis://localhost:6379";
}

let cachedClient = global.redisClient;

if (!cachedClient) {
  cachedClient = global.redisClient = createClient({
    url: redisUrl,
    socket: {
      reconnectStrategy: (retries) => {
        if (retries > 10) return new Error("Redis reconnect limit reached");
        return Math.min(retries * 100, 3000);
      },
    },
  });

  cachedClient.on("connect", () => {
    console.log("[Redis] Connected successfully");
  });

  cachedClient.on("error", (err) => {
    console.warn("[Redis] Client error:", err.message);
  });

  cachedClient.connect().catch((err) => {
    console.warn("[Redis] Connection attempt failed:", err.message);
  });
}

export const redisClient = cachedClient;

/**
 * Default cache TTLs (in seconds)
 */
export const CACHE_TTL = {
  CARS_LIST: 600,       // 10 minutes for car browse/filter results
  CAR_DETAILS: 1800,    // 30 minutes for single car details
  BOOKED_DATES: 600,    // 10 minutes for booked date calendar ranges
  RESERVATION_LOCK: 900 // 15 minutes (900 seconds) for checkout lock
};

export const getCache = async (key) => {
  try {
    if (!redisClient.isReady) return null;
    const data = await redisClient.get(key);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.warn(`Redis getCache error for key [${key}]:`, error.message);
    return null;
  }
};

export const setCache = async (key, data, ttlSeconds = CACHE_TTL.CARS_LIST) => {
  try {
    if (!redisClient.isReady) return false;
    await redisClient.set(key, JSON.stringify(data), { EX: ttlSeconds });
    return true;
  } catch (error) {
    console.warn(`Redis setCache error for key [${key}]:`, error.message);
    return false;
  }
};

export const delCache = async (key) => {
  try {
    if (!redisClient.isReady) return false;
    await redisClient.del(key);
    return true;
  } catch (error) {
    console.warn(`Redis delCache error for key [${key}]:`, error.message);
    return false;
  }
};

export const deleteCachePattern = async (pattern) => {
  try {
    if (!redisClient.isReady) return;
    const keysToDelete = [];
    for await (const chunk of redisClient.scanIterator({ MATCH: pattern, COUNT: 100 })) {
      if (Array.isArray(chunk)) {
        keysToDelete.push(...chunk);
      } else if (chunk) {
        keysToDelete.push(chunk);
      }
    }
    if (keysToDelete.length > 0) {
      for (const k of keysToDelete) {
        await redisClient.del(k);
      }
    }
  } catch (error) {
    console.warn(`Redis deleteCachePattern error for pattern [${pattern}]:`, error.message);
  }
};

export const invalidateCarCache = async (carId = null) => {
  await deleteCachePattern("cars:list:*");
  if (carId) {
    await delCache(`cars:detail:${carId}`);
    await delCache(`cars:booked:${carId}`);
  }
};

export const acquireCarLock = async (
  carId,
  lockData,
  ttlSeconds = CACHE_TTL.RESERVATION_LOCK
) => {
  const lockKey = `lock:car:${carId}`;

  try {
    if (!redisClient.isReady) {
      console.warn("Redis client not ready, bypassing checkout lock");
      return { acquired: true, bypassed: true };
    }

    const payload = {
      ...lockData,
      lockedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    };

    const existingLockStr = await redisClient.get(lockKey);
    if (existingLockStr) {
      let existingLock;
      try {
        existingLock = JSON.parse(existingLockStr);
      } catch {
        existingLock = { bookingId: existingLockStr };
      }

      const isOwner =
        (lockData.bookingId && String(existingLock.bookingId) === String(lockData.bookingId)) ||
        (lockData.customerId && String(existingLock.customerId) === String(lockData.customerId));

      if (isOwner) {
        await redisClient.set(lockKey, JSON.stringify(payload), { EX: ttlSeconds });
        return { acquired: true, isReentrant: true, lock: payload };
      }

      return { acquired: false, heldByOther: true, lock: existingLock };
    }

    const result = await redisClient.set(lockKey, JSON.stringify(payload), {
      NX: true,
      EX: ttlSeconds,
    });

    if (result === "OK") {
      return { acquired: true, lock: payload };
    }

    const currentLock = await getCache(lockKey);
    return { acquired: false, heldByOther: true, lock: currentLock };
  } catch (error) {
    console.error(`Error acquiring reservation lock for car [${carId}]:`, error.message);
    return { acquired: true, bypassed: true };
  }
};

export const releaseCarLock = async (carId, ownerIdentifier = null) => {
  const lockKey = `lock:car:${carId}`;

  try {
    if (!redisClient.isReady) return false;

    if (ownerIdentifier) {
      const currentLockStr = await redisClient.get(lockKey);
      if (currentLockStr) {
        let currentLock;
        try {
          currentLock = JSON.parse(currentLockStr);
        } catch {
          currentLock = { bookingId: currentLockStr };
        }

        const isOwner =
          String(currentLock.bookingId) === String(ownerIdentifier) ||
          String(currentLock.customerId) === String(ownerIdentifier);

        if (!isOwner) {
          return false;
        }
      }
    }

    await redisClient.del(lockKey);
    return true;
  } catch (error) {
    console.error(`Error releasing reservation lock for car [${carId}]:`, error.message);
    return false;
  }
};

export const getCarLock = async (carId) => {
  return await getCache(`lock:car:${carId}`);
};
