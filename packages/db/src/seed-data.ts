import { createRequire } from "node:module";
import countries from "i18n-iso-countries";
import { evaluateMarketPolicy, type MarketAgeTier, type MarketServiceClass } from "./markets";

/**
 * Seed data for `market_policies`.
 *
 * The safe seed is *every* ISO 3166-1 alpha-2 market marked `blocked`, with no legal
 * sign-off. Enabling a market is then a reviewed, audited data change per ADR-0018, not
 * something that happens because a country code was forgotten or a developer ran a seed
 * against production.
 *
 * `development` additionally enables a single fixture market (US) so the product and
 * tests have somewhere to run. The fixture cannot be produced in `production` mode and
 * carries a sign-off reference that is obviously not a real one; the seed script prints
 * a warning whenever it is applied.
 */

const require = createRequire(import.meta.url);
countries.registerLocale(require("i18n-iso-countries/langs/en.json"));

export type SeedMode = "production" | "development";

export const DEV_FIXTURE_MARKET = "US";
export const DEV_FIXTURE_SIGNOFF = "DEV-FIXTURE-NOT-A-LEGAL-SIGNOFF";
export const DEV_FIXTURE_SIGNER = "dev-fixture";

export interface MarketSeedRow {
  market: string;
  serviceClass: MarketServiceClass;
  requiredAgeTier: MarketAgeTier;
  guestMinutesPerDay: number;
  monetizationEnabled: boolean;
  matchingEnabled: boolean;
  residency: "global" | "eu";
  retentionDays: number;
  reportingAuthority: string;
  primaryLanguages: string[];
  moderatorCoverage: boolean;
  legalSignoffRef: string | null;
  signer: string | null;
  policyVersion: number;
  effectiveAt: Date;
  changelog: string;
}

export interface IsoMarket {
  market: string;
  name: string;
}

/** All ISO 3166-1 alpha-2 codes known to the locale data, sorted by code. */
export function listIsoMarkets(): IsoMarket[] {  const codes = Object.keys(countries.getAlpha2Codes())
    .map((code) => code.toUpperCase())
    .filter((code) => /^[A-Z]{2}$/.test(code));

  return [...new Set(codes)]
    .sort((left, right) => left.localeCompare(right))
    .map((code) => ({ market: code, name: countries.getName(code, "en") ?? code }));
}

export function buildMarketSeeds(mode: SeedMode, now: Date = new Date()): MarketSeedRow[] {
  const baseline = listIsoMarkets().map(({ market }) => blockedRow(market, now));

  if (mode === "production") {
    return baseline;
  }

  const fixture = devFixtureRow(now);
  const index = baseline.findIndex((row) => row.market === DEV_FIXTURE_MARKET);
  if (index === -1) {
    throw new Error(
      `Seed data is missing the development fixture market ${DEV_FIXTURE_MARKET}; refusing to continue.`,
    );
  }
  baseline[index] = fixture;
  return baseline;
}

function blockedRow(market: string, now: Date): MarketSeedRow {
  return {
    market,
    serviceClass: "blocked",
    requiredAgeTier: "t1_estimated",
    guestMinutesPerDay: 0,
    monetizationEnabled: false,
    matchingEnabled: false,
    residency: "global",
    retentionDays: 30,
    reportingAuthority: "pending_legal",
    primaryLanguages: [],
    moderatorCoverage: false,
    legalSignoffRef: null,
    signer: null,
    policyVersion: 1,
    effectiveAt: now,
    changelog: "seeded blocked by default (ADR-0018 fail-closed)",
  };
}

function devFixtureRow(now: Date): MarketSeedRow {
  return {
    market: DEV_FIXTURE_MARKET,
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
    legalSignoffRef: DEV_FIXTURE_SIGNOFF,
    signer: DEV_FIXTURE_SIGNER,
    policyVersion: 1,
    effectiveAt: now,
    changelog:
      "DEVELOPMENT ONLY: fixture market for local runs and tests. Not a legal sign-off.",
  };
}

/**
 * Fails loudly before writing if a seed row would not resolve the way it claims. This
 * catches the classic mistake of seeding an enabled market that the resolver then blocks
 * (or vice versa) after a policy field changes.
 */
export function assertSeedInvariants(
  rows: readonly MarketSeedRow[],
  now: Date = new Date(),
): void {
  if (rows.length === 0) throw new Error("seed rows are empty");

  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.market)) throw new Error(`duplicate seed row for ${row.market}`);
    seen.add(row.market);

    const decision = evaluateMarketPolicy(row, now);
    if (row.serviceClass === "blocked") {
      if (decision.enabled) {
        throw new Error(`seed row ${row.market} is blocked but resolves as enabled`);
      }
      continue;
    }
    if (!decision.enabled) {
      throw new Error(
        `seed row ${row.market} is ${row.serviceClass} but resolves as blocked: ${decision.reasons.join(", ")}`,
      );
    }
  }

  if (!seen.has(DEV_FIXTURE_MARKET)) {
    throw new Error(`seed rows are missing the fixture market ${DEV_FIXTURE_MARKET}`);
  }
}
