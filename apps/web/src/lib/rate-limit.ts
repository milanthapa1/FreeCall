/**
 * Server-side rate limiting backed by Redis.
 *
 * Uses a fixed-window counter per key. Each key carries its own window size and limit
 * so different surfaces (IP, device, user) can have independent policies.
 *
 * The Redis pattern:
 *   INCR  rl:{key}
 *   EXPIREX rl:{key} {windowSeconds}  (only on first increment)
 * is a standard fixed-window approach that is race-free for our use case: an occasional
 * double-count at window boundary is acceptable; we are not a payment processor.
 */

import type Redis from "ioredis";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number; // unix ms
}

/**
 * Increments a fixed-window counter in Redis and returns whether the request is allowed.
 *
 * @param redis       Connected ioredis client.
 * @param key         Counter key (should already be namespaced, e.g. `rl:ip:...`).
 * @param limit       Max requests per window.
 * @param windowSec   Window duration in seconds.
 */
export async function checkRateLimit(
  redis: Redis,
  key: string,
  limit: number,
  windowSec: number,
): Promise<RateLimitResult> {
  const now = Date.now();

  const pipeline = redis.pipeline();
  pipeline.incr(key);
  pipeline.ttl(key);
  const [[, count], [, ttl]] = (await pipeline.exec()) as [
    [null, number],
    [null, number],
  ];

  // Set expiry only on first increment (INCR returns 1).
  if (count === 1) {
    void redis.expire(key, windowSec);
  }

  const remaining = Math.max(0, limit - count);
  const resetAt = now + (ttl > 0 ? ttl * 1000 : windowSec * 1000);

  return { allowed: count <= limit, remaining, resetAt };
}

/** Hash a value for use as a rate-limit key suffix. Never store raw IPs. */
export function hashForKey(value: string): string {
  // Simple djb2-style numeric hash → hex. Fast, not cryptographic.
  // For IP-based keys a cryptographic hash is not required because the key
  // namespace prefix provides scoping; the raw IP never appears in the key.
  let h = 5381;
  for (let i = 0; i < value.length; i++) {
    h = ((h << 5) + h) ^ (value.charCodeAt(i) & 0xff);
    h >>>= 0; // keep 32-bit unsigned
  }
  return h.toString(16).padStart(8, "0");
}
