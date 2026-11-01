import { describe, expect, it } from "vitest";
import {
  evaluateMarketPolicy,
  isConcreteReportingAuthority,
  normalizeMarket,
  type MarketDenialReason,
  type MarketPolicy,
} from "../src/markets";

const NOW = new Date("2026-10-30T12:00:00.000Z");

function policy(overrides: Partial<MarketPolicy> = {}): MarketPolicy {
  return {
    market: "US",
    serviceClass: "limited",
    requiredAgeTier: "t1_estimated",
    guestMinutesPerDay: 30,
    monetizationEnabled: false,
    matchingEnabled: true,
    residency: "global",
    retentionDays: 30,
    reportingAuthority: "both",
    primaryLanguages: ["en"],
    moderatorCoverage: true,
    legalSignoffRef: "LEGAL-2026-001",
    signer: "General Counsel",
    policyVersion: 1,
    effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("normalizeMarket", () => {
  it("normalizes case and whitespace", () => {
    expect(normalizeMarket(" us ")).toBe("US");
    expect(normalizeMarket("eu")).toBe("EU");
  });

  it("rejects anything that is not a two-letter code", () => {
    expect(normalizeMarket("USA")).toBeNull();
    expect(normalizeMarket("1A")).toBeNull();
    expect(normalizeMarket("")).toBeNull();
    expect(normalizeMarket(null)).toBeNull();
  });
});

describe("isConcreteReportingAuthority", () => {
  it("accepts NCMEC, both, and a national authority", () => {
    expect(isConcreteReportingAuthority("ncmec")).toBe(true);
    expect(isConcreteReportingAuthority("both")).toBe(true);
    expect(isConcreteReportingAuthority("national:GB")).toBe(true);
  });

  it("rejects pending and malformed values", () => {
    expect(isConcreteReportingAuthority("pending_legal")).toBe(false);
    expect(isConcreteReportingAuthority("national:gb")).toBe(false);
    expect(isConcreteReportingAuthority("interpol")).toBe(false);
  });
});

describe("evaluateMarketPolicy", () => {
  it("fails closed when the row is missing", () => {
    const decision = evaluateMarketPolicy(undefined, NOW);
    expect(decision.serviceClass).toBe("blocked");
    expect(decision.enabled).toBe(false);
    expect(decision.matchingEnabled).toBe(false);
    expect(decision.monetizationEnabled).toBe(false);
    expect(decision.requiredAgeTier).toBe("t3_locked");
    expect(decision.guestMinutesPerDay).toBe(0);
    expect(decision.reasons).toEqual(["missing_policy_row"]);
  });

  it("enables a fully provisioned limited market without monetization", () => {
    const decision = evaluateMarketPolicy(policy(), NOW);
    expect(decision.enabled).toBe(true);
    expect(decision.serviceClass).toBe("limited");
    expect(decision.matchingEnabled).toBe(true);
    expect(decision.monetizationEnabled).toBe(false);
    expect(decision.reasons).toEqual([]);
  });

  it("enables monetization for a full market", () => {
    const decision = evaluateMarketPolicy(
      policy({ serviceClass: "full", monetizationEnabled: true }),
      NOW,
    );
    expect(decision.enabled).toBe(true);
    expect(decision.monetizationEnabled).toBe(true);
  });

  it("keeps a declared blocked market blocked", () => {
    const decision = evaluateMarketPolicy(policy({ serviceClass: "blocked" }), NOW);
    expect(decision.serviceClass).toBe("blocked");
    expect(decision.enabled).toBe(false);
    expect(decision.matchingEnabled).toBe(false);
    expect(decision.monetizationEnabled).toBe(false);
    expect(decision.requiredAgeTier).toBe("t3_locked");
  });

  it.each<[string, Partial<MarketPolicy>, MarketDenialReason]>([
    ["missing legal sign-off", { legalSignoffRef: null }, "missing_legal_signoff"],
    ["blank legal sign-off", { legalSignoffRef: "   " }, "missing_legal_signoff"],
    ["missing signer", { signer: null }, "missing_legal_signoff"],
    ["missing moderator coverage", { moderatorCoverage: false }, "missing_moderator_coverage"],
    ["pending reporting authority", { reportingAuthority: "pending_legal" }, "reporting_authority_not_set"],
    ["malformed reporting authority", { reportingAuthority: "ncmec,interpol" }, "reporting_authority_not_set"],
    ["unprovisioned residency", { residency: "us" }, "residency_not_provisioned"],
    ["self-declared age only", { requiredAgeTier: "t0_declared" }, "age_assurance_required"],
    ["invalid age tier", { requiredAgeTier: "adult" as MarketPolicy["requiredAgeTier"] }, "invalid_required_age_tier"],
    ["invalid guest limit", { guestMinutesPerDay: -1 }, "invalid_guest_limit"],
    ["invalid retention", { retentionDays: 0 }, "invalid_retention"],
    ["invalid language", { primaryLanguages: ["english"] }, "invalid_primary_language"],
    ["invalid policy version", { policyVersion: 0 }, "invalid_policy_version"],
    ["invalid market code", { market: "USA" }, "invalid_market_code"],
    ["future effective date", { effectiveAt: new Date("2027-01-01T00:00:00.000Z") }, "policy_not_effective"],
    ["limited market with monetization", { monetizationEnabled: true }, "monetization_not_allowed"],
  ])("blocks on %s", (_label, overrides, reason) => {
    const decision = evaluateMarketPolicy(policy(overrides), NOW);
    expect(decision.enabled).toBe(false);
    expect(decision.serviceClass).toBe("blocked");
    expect(decision.matchingEnabled).toBe(false);
    expect(decision.monetizationEnabled).toBe(false);
    expect(decision.reasons).toContain(reason);
  });

  it("reports every independent problem, not just the first", () => {
    const decision = evaluateMarketPolicy(
      policy({ legalSignoffRef: null, moderatorCoverage: false, residency: "apac" }),
      NOW,
    );
    expect(decision.reasons).toEqual(
      expect.arrayContaining([
        "missing_legal_signoff",
        "missing_moderator_coverage",
        "residency_not_provisioned",
      ]),
    );
  });

  it("respects an operator kill switch on matching without blocking the market", () => {
    const decision = evaluateMarketPolicy(policy({ matchingEnabled: false }), NOW);
    expect(decision.enabled).toBe(true);
    expect(decision.matchingEnabled).toBe(false);
  });

  it("treats an unparsable effective date as not effective", () => {
    const decision = evaluateMarketPolicy(
      policy({ effectiveAt: new Date(Number.NaN) }),
      NOW,
    );
    expect(decision.enabled).toBe(false);
    expect(decision.reasons).toContain("policy_not_effective");
  });
});
