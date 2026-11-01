import { createHash } from "node:crypto";

/**
 * Computes a SHA-256 hash formatted as a lowercase hex string.
 * Used for session token hashes and device fingerprint hashes.
 */
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashToken(token: string): string {
  return sha256(token);
}

export function hashFingerprint(fingerprint: string): string {
  return sha256(`fp:${fingerprint}`);
}
