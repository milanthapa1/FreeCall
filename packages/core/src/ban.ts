/**
 * Ban engine — domain logic only, no I/O.
 *
 * The ban engine evaluates whether a set of active ban rows should prevent a user from
 * performing a given action. Enforcement surfaces (realtime, web, worker) call this
 * synchronously after loading the user's bans from the cache or DB.
 */

export type BanScope = "call" | "dm" | "upload" | "platform";

export interface ActiveBan {
  scope: BanScope;
  startsAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

export type BanCheckResult =
  | { banned: false }
  | { banned: true; scope: BanScope; permanent: boolean };

/**
 * Check whether any active ban prevents the given action scope.
 *
 * A ban is active when:
 * - `startsAt` is in the past.
 * - `expiresAt` is null (permanent) or in the future.
 * - `revokedAt` is null (not revoked).
 *
 * A `full` scope ban blocks all narrower scopes.
 */
export function checkBan(
  bans: readonly ActiveBan[],
  actionScope: BanScope,
  now: Date = new Date(),
): BanCheckResult {
  const SCOPE_HIERARCHY: Record<BanScope, BanScope[]> = {
    platform: ["platform", "call", "dm", "upload"],
    call: ["platform", "call"],
    dm: ["platform", "dm"],
    upload: ["platform", "upload"],
  };

  const blockedBy = SCOPE_HIERARCHY[actionScope];

  for (const ban of bans) {
    if (!blockedBy.includes(ban.scope)) continue;
    if (ban.revokedAt !== null) continue;
    if (ban.startsAt > now) continue;
    if (ban.expiresAt !== null && ban.expiresAt <= now) continue;

    return { banned: true, scope: ban.scope, permanent: ban.expiresAt === null };
  }

  return { banned: false };
}

/** Build a reason code for an automatic ban trigger. */
export function buildAutoBanReason(opts: {
  label: string;
  model: string;
  score: number;
  policyVersion: string;
}): string {
  return `auto:${opts.label}:${opts.model}@${opts.policyVersion}:${opts.score.toFixed(3)}`;
}

/** Whether a ban reason code represents a system (automated) action. */
export function isAutoBan(reasonCode: string): boolean {
  return reasonCode.startsWith("auto:");
}
