import type { AgeTier } from "@freecall/protocol";
import type { MarketAgeTier, MarketDecision } from "@freecall/db";

const TIER_ORDER: Record<AgeTier, number> = {
  t3_locked: -1, // locked / minor: never satisfied
  t0_declared: 0,
  t1_estimated: 1,
  t2_verified: 2,
};

/**
 * Checks if a user's achieved age tier satisfies the required tier of the market.
 * t3_locked always returns false.
 */
export function isAgeTierSatisfied(userTier: AgeTier, requiredTier: MarketAgeTier | AgeTier): boolean {
  if (userTier === "t3_locked") return false;
  const userRank = TIER_ORDER[userTier];
  const requiredRank = TIER_ORDER[requiredTier as AgeTier] ?? 0;
  return userRank >= requiredRank;
}

/**
 * Calculates accurate chronological age from a date of birth.
 */
export function calculateAge(dob: Date, referenceDate: Date = new Date()): number {
  let age = referenceDate.getFullYear() - dob.getFullYear();
  const monthDiff = referenceDate.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && referenceDate.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}

/**
 * Validates whether a provided DOB is at least 18 years old.
 */
export function isAdult(dob: Date, referenceDate: Date = new Date()): boolean {
  return calculateAge(dob, referenceDate) >= 18;
}

export interface AgeGateCheckResult {
  allowed: boolean;
  reason?: "underage" | "age_assurance_required" | "account_locked" | "market_blocked";
  requiredTier: MarketAgeTier;
  userTier: AgeTier;
}

export function evaluateAgeGate(
  userTier: AgeTier,
  marketDecision: MarketDecision,
): AgeGateCheckResult {
  if (userTier === "t3_locked") {
    return {
      allowed: false,
      reason: "account_locked",
      requiredTier: marketDecision.requiredAgeTier,
      userTier,
    };
  }

  if (!marketDecision.enabled || !marketDecision.matchingEnabled) {
    return {
      allowed: false,
      reason: "market_blocked",
      requiredTier: marketDecision.requiredAgeTier,
      userTier,
    };
  }

  const satisfied = isAgeTierSatisfied(userTier, marketDecision.requiredAgeTier);
  if (!satisfied) {
    return {
      allowed: false,
      reason: "age_assurance_required",
      requiredTier: marketDecision.requiredAgeTier,
      userTier,
    };
  }

  return {
    allowed: true,
    requiredTier: marketDecision.requiredAgeTier,
    userTier,
  };
}
