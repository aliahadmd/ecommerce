import Redis from "ioredis";
import { getEnv } from "@ecommerce/config";

let client: Redis | null = null;

/** Shared ioredis singleton (rate limiting + caching in phase 1). */
export function getRedis(): Redis {
  if (!client) {
    client = new Redis(getEnv().REDIS_URL, {
      maxRetriesPerRequest: 2,
      lazyConnect: false,
    });
  }
  return client;
}

/**
 * Fixed-window rate limiter. Returns true when the action is allowed.
 * Keys look like `ratelimit:{name}:{identifier}`.
 * EXPIRE NX keeps the window correct even if a process dies between
 * INCR and EXPIRE (no key can end up without a TTL).
 */
export async function rateLimit(
  name: string,
  identifier: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const redis = getRedis();
  const key = `ratelimit:${name}:${identifier}`;
  const count = await redis.incr(key);
  await redis.expire(key, windowSeconds, "NX");
  return count <= limit;
}

/**
 * Redis-backed JSON cache with DB fallback. Redis failures are logged and
 * skipped — caching must never take a feature down.
 */
export async function cachedJson<T>(
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T>,
): Promise<T> {
  const redis = getRedis();
  try {
    const hit = await redis.get(key);
    if (hit) return JSON.parse(hit) as T;
  } catch (err) {
    console.error("[redis] cache read failed:", err);
  }
  const value = await loader();
  try {
    await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch (err) {
    console.error("[redis] cache write failed:", err);
  }
  return value;
}

/** Best-effort cache invalidation (never throws). */
export async function invalidateCache(key: string): Promise<void> {
  try {
    await getRedis().del(key);
  } catch (err) {
    console.error("[redis] cache invalidation failed:", err);
  }
}
