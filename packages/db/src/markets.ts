/**
 * Pure, database-free market policy resolution.
 *
 * Every entry point (web, realtime, worker) resolves the request's market to exactly one
 * policy row and then calls `evaluateMarketPolicy`. That function is intentionally
 * paranoid: any missing or malformed field collapses the market to `blocked`. It is the
 * single place where "can we serve this market?" is decided, so it is heavily tested.
 *
 * ADR-0018 governs the contract; this module must not learn about HTTP, Redis or Drizzle.
 */

export type MarketServiceClass = "full" | "strict" | "limited" | "blocked";
export type MarketAgeTier = "t0_declared" | "t1_estimated" | "t2_verified" | "t3_locked";
export type ProvisionedResidency = "global" | "eu";

export type MarketDenialReason =
  | "missing_policy_row"
  | "invalid_market_code"
  | "invalid_policy_version"
  | "policy_not_effective"
  | "invalid_guest_limit"
  | "invalid_retention"
  | "invalid_primary_language"
  | "invalid_required_age_tier"
  | "missing_legal_signoff"
  | "missing_moderator_coverage"
  | "residency_not_provisioned"
  | "reporting_authority_not_set"
  | "age_assurance_required"
  | "monetization_not_allowed";

export interface MarketPolicy {
  market: string;
  serviceClass: MarketServiceClass;
  requiredAgeTier: MarketAgeTier;
  guestMinutesPerDay: number;
  monetizationEnabled: boolean;
  matchingEnabled: boolean;
  residency: string;
  retentionDays: number;
  reportingAuthority: string;
  primaryLanguages: readonly string[];
  moderatorCoverage: boolean;
  legalSignoffRef: string | null;
  signer: string | null;
  policyVersion: number;
  effectiveAt: Date;
}

export interface MarketDecision {
  market: string;
  serviceClass: MarketServiceClass;
  /** True only when no denial reason applies. */
  enabled: boolean;
  matchingEnabled: boolean;
  monetizationEnabled: boolean;
  requiredAgeTier: MarketAgeTier;
  guestMinutesPerDay: number;
  residency: ProvisionedResidency;
  retentionDays: number;
  reportingAuthority: string;
  policyVersion: number;
  /** Empty when enabled. Internal only — never shown to users. */
  reasons: readonly MarketDenialReason[];
}

/** Residency values that are actually provisioned. Everything else fails closed. */
export const PROVISIONED_RESIDENCIES: readonly ProvisionedResidency[] = ["global", "eu"];

const AGE_TIERS: readonly MarketAgeTier[] = [
  "t0_declared",
  "t1_estimated",
  "t2_verified",
  "t3_locked",
];

const LANGUAGE_CODE = /^[a-z]{2}$/;
const NATIONAL_AUTHORITY = /^national:[A-Z]{2}$/;

export function normalizeMarket(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(normalized) ? normalized : null;
}

export function isProvisionedResidency(value: string): value is ProvisionedResidency {
  return (PROVISIONED_RESIDENCIES as readonly string[]).includes(value);
}

/** A concrete authority Legal can file with. `pending_legal` is not concrete. */
export function isConcreteReportingAuthority(value: string): boolean {
  return value === "ncmec" || value === "both" || NATIONAL_AUTHORITY.test(value);
}

export function isMarketAgeTier(value: string): value is MarketAgeTier {
  return (AGE_TIERS as readonly string[]).includes(value);
}

/**
 * Resolves a (possibly absent) policy row to an effective decision.
 *
 * When `policy` is null or undefined the market is treated as `blocked` with
 * `missing_policy_row`; callers must alert on that reason, because it means either a new
 * ISO code appeared or the policy table lost a row.
 */
export function evaluateMarketPolicy(
  policy: MarketPolicy | null | undefined,
  now: Date = new Date(),
): MarketDecision {
  if (!policy) {
    return blockedDecision("??", ["missing_policy_row"]);
  }

  const market = normalizeMarket(policy.market);
  const reasons: MarketDenialReason[] = [];

  if (!market) reasons.push("invalid_market_code");
  if (!Number.isInteger(policy.policyVersion) || policy.policyVersion < 1) {
    reasons.push("invalid_policy_version");
  }
  if (
    !(policy.effectiveAt instanceof Date) ||
    Number.isNaN(policy.effectiveAt.getTime()) ||
    policy.effectiveAt.getTime() > now.getTime()
  ) {
    reasons.push("policy_not_effective");
  }
  if (!Number.isInteger(policy.guestMinutesPerDay) || policy.guestMinutesPerDay < 0) {
    reasons.push("invalid_guest_limit");
  }
  if (!Number.isInteger(policy.retentionDays) || policy.retentionDays < 1) {
    reasons.push("invalid_retention");
  }
  if (!policy.primaryLanguages.every((language) => LANGUAGE_CODE.test(language))) {
    reasons.push("invalid_primary_language");
  }

  const ageTierValid = isMarketAgeTier(policy.requiredAgeTier);
  if (!ageTierValid) reasons.push("invalid_required_age_tier");

  if (policy.serviceClass === "blocked") {
    return {
      ...blockedDecision(market ?? "??", reasons),
      reportingAuthority: policy.reportingAuthority,
      policyVersion: Number.isInteger(policy.policyVersion) ? policy.policyVersion : 0,
    };
  }

  if (!policy.legalSignoffRef?.trim() || !policy.signer?.trim()) {
    reasons.push("missing_legal_signoff");
  }
  if (!policy.moderatorCoverage) reasons.push("missing_moderator_coverage");
  if (!isProvisionedResidency(policy.residency)) reasons.push("residency_not_provisioned");
  if (!isConcreteReportingAuthority(policy.reportingAuthority)) {
    reasons.push("reporting_authority_not_set");
  }
  if (policy.requiredAgeTier === "t0_declared") reasons.push("age_assurance_required");
  if (policy.serviceClass === "limited" && policy.monetizationEnabled) {
    reasons.push("monetization_not_allowed");
  }

  const enabled = reasons.length === 0;

  return {
    market: market ?? "??",
    serviceClass: enabled ? policy.serviceClass : "blocked",
    enabled,
    matchingEnabled: enabled && policy.matchingEnabled,
    monetizationEnabled:
      enabled && policy.monetizationEnabled && policy.serviceClass !== "limited",
    requiredAgeTier: enabled && ageTierValid ? policy.requiredAgeTier : "t3_locked",
    guestMinutesPerDay: enabled ? policy.guestMinutesPerDay : 0,
    residency: isProvisionedResidency(policy.residency) ? policy.residency : "global",
    retentionDays: Number.isInteger(policy.retentionDays) && policy.retentionDays > 0
      ? policy.retentionDays
      : 30,
    reportingAuthority: policy.reportingAuthority,
    policyVersion: Number.isInteger(policy.policyVersion) && policy.policyVersion > 0
      ? policy.policyVersion
      : 0,
    reasons,
  };
}

function blockedDecision(market: string, reasons: readonly MarketDenialReason[]): MarketDecision {
  return {
    market,
    serviceClass: "blocked",
    enabled: false,
    matchingEnabled: false,
    monetizationEnabled: false,
    requiredAgeTier: "t3_locked",
    guestMinutesPerDay: 0,
    residency: "global",
    retentionDays: 30,
    reportingAuthority: "pending_legal",
    policyVersion: 0,
    reasons,
  };
}
