import Redis from "ioredis"
import { getEnv } from "@ecommerce/config"

let client: Redis | null = null

/** Shared ioredis singleton (rate limiting + caching in phase 1). */
export function getRedis(): Redis {
  if (!client) {
    client = new Redis(getEnv().REDIS_URL, {
      maxRetriesPerRequest: 2,
      lazyConnect: false,
    })
  }
  return client
}

/**
 * Fixed-window rate limiter. Returns true when the action is allowed.
 * Keys look like `ratelimit:{name}:{identifier}`.
 */
export async function rateLimit(
  name: string,
  identifier: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const redis = getRedis()
  const key = `ratelimit:${name}:${identifier}`
  const count = await redis.incr(key)
  if (count === 1) await redis.expire(key, windowSeconds)
  return count <= limit
}
