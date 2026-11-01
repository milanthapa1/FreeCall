import { randomBytes, randomInt } from "node:crypto";

/**
 * UUID v7 (RFC 9562) with a monotonic guard.
 *
 * Layout: 48-bit big-endian Unix milliseconds, version nibble 7, 12-bit counter,
 * variant bits 10, 62 random bits. The counter replaces 12 random bits so that IDs
 * generated in the same millisecond still sort in creation order. If the counter wraps,
 * the timestamp advances by 1 ms; if the system clock moves backwards, the timestamp is
 * clamped to the last emitted value. IDs therefore never go backwards, which matters for
 * keyset pagination and for "latest event wins" logic in moderation.
 *
 * Dependency-free (no `uuid` package) and safe to call on every request.
 */

const MAX_TIMESTAMP = 0xffff_ffff_ffff;
const COUNTER_MASK = 0x0fff;
const COUNTER_SPACE = COUNTER_MASK + 1;

let lastTimestamp = 0;
let counter = 0;
let hasEmitted = false;

export function uuidv7(now: number = Date.now()): string {
  if (!Number.isFinite(now) || now < 0) {
    throw new RangeError("uuidv7: now must be a non-negative finite number of milliseconds");
  }

  let timestamp = Math.trunc(now);

  if (hasEmitted && timestamp <= lastTimestamp) {
    timestamp = lastTimestamp;
    counter += 1;
    if (counter > COUNTER_MASK) {
      timestamp = lastTimestamp + 1;
      counter = 0;
    }
  } else {
    // Random start makes it harder to infer traffic volume from a single ID.
    counter = randomInt(0, COUNTER_SPACE);
  }

  if (timestamp > MAX_TIMESTAMP) {
    throw new RangeError("uuidv7: timestamp exceeds 48 bits");
  }

  lastTimestamp = timestamp;
  hasEmitted = true;

  const bytes = randomBytes(16);
  const high = Math.floor(timestamp / 0x1_0000_0000);
  const low = timestamp >>> 0;
  bytes[0] = (high >>> 8) & 0xff;
  bytes[1] = high & 0xff;
  bytes[2] = (low >>> 24) & 0xff;
  bytes[3] = (low >>> 16) & 0xff;
  bytes[4] = (low >>> 8) & 0xff;
  bytes[5] = low & 0xff;
  bytes[6] = 0x70 | ((counter >>> 8) & 0x0f);
  bytes[7] = counter & 0xff;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  return formatUuid(bytes);
}

/**
 * Adds a helper suffix to a UUID to build namespaced identifiers (for example a Redis
 * exclusion member or an evidence object key prefix). Not part of the UUID spec.
 */
export function uuidv7Compact(now: number = Date.now()): string {
  return uuidv7(now).replaceAll("-", "");
}

const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isUuidV7(value: string): boolean {
  return UUID_V7_PATTERN.test(value);
}

/** Extracts the embedded creation time, or null when the value is not a v7 UUID. */
export function uuidv7Timestamp(value: string): Date | null {
  if (!isUuidV7(value)) return null;
  const hex = value.replaceAll("-", "").slice(0, 12);
  return new Date(Number.parseInt(hex, 16));
}

function formatUuid(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
