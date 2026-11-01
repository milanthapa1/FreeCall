/**
 * Trust score computation.
 *
 * The trust band is derived from a numeric score [0, 100]:
 *   0–33  → low
 *   34–66 → normal
 *   67+   → high
 *
 * Signals that affect the score are immutable domain events; the score is recomputed
 * from the component map, never mutated in place.
 */

import type { TrustBand } from "@freecall/protocol";

export interface TrustComponents {
  /** Reports received as a fraction of calls. Ranges 0-1. */
  reportRate: number;
  /** Skips received from partner as a fraction of calls. Ranges 0-1. */
  partnerSkipRate: number;
  /** Account age weight: 0 for brand-new, approaches 1 asymptotically. */
  accountAgeWeight: number;
  /** Age tier bonus: higher assurance = higher score. */
  ageTierBonus: number;
  /** Manual moderator adjustment (-50 to +50). */
  moderatorAdjustment: number;
}

/** Compute a trust score in [0, 100] from signal components. */
export function computeTrustScore(components: TrustComponents): number {
  const base = 50;
  const reportPenalty = Math.round(components.reportRate * 40);
  const skipPenalty = Math.round(components.partnerSkipRate * 20);
  const ageBonus = Math.round(components.accountAgeWeight * 10);
  const tierBonus = components.ageTierBonus;
  const modAdj = Math.max(-50, Math.min(50, components.moderatorAdjustment));

  const raw = base - reportPenalty - skipPenalty + ageBonus + tierBonus + modAdj;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

/** Map a numeric trust score to a named band. */
export function scoreToTrustBand(score: number): TrustBand {
  if (score <= 33) return "low";
  if (score >= 67) return "high";
  return "normal";
}

/** Age tier numeric bonus (+0 to +15). */
export function ageTierBonus(tier: string): number {
  switch (tier) {
    case "t3_locked":
      return -100; // effectively ineligible
    case "t0_declared":
      return 0;
    case "t1_estimated":
      return 5;
    case "t2_verified":
      return 15;
    default:
      return 0;
  }
}

/** Account age weight (asymptotic approach to 1.0 over 30 days). */
export function accountAgeWeight(createdAtMs: number, nowMs: number = Date.now()): number {
  const days = Math.max(0, (nowMs - createdAtMs) / 86_400_000);
  return 1 - Math.exp(-days / 10); // e-fold at ~10 days
}
