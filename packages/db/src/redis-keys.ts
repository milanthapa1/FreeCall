/**
 * Shared Redis key helpers.
 *
 * Both `apps/realtime` and `apps/worker` must use the same key scheme so
 * the worker's ban writes are visible to the realtime hot-path check.
 *
 * Key patterns:
 *   ban:{userId}            → ban flag (value "1", TTL-refreshed by worker)
 *   presence:{sid}          → presence TTL for a session
 *   cap:{userId}:{date}     → guest daily cap counter
 */

export function redisBanKey(userId: string): string {
  return `ban:${userId}`;
}

export function redisPresenceKey(sid: string): string {
  return `presence:${sid}`;
}

export function redisGuestCapKey(userId: string, date: string): string {
  return `cap:${userId}:${date}`;
}
