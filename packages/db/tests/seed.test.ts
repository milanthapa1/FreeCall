import { describe, expect, it } from "vitest";
import { evaluateMarketPolicy } from "../src/markets";
import {
  DEV_FIXTURE_MARKET,
  DEV_FIXTURE_SIGNOFF,
  assertSeedInvariants,
  buildMarketSeeds,
  listIsoMarkets,
  type MarketSeedRow,
} from "../src/seed-data";

const NOW = new Date("2026-10-30T12:00:00.000Z");

describe("listIsoMarkets", () => {
  it("contains the full ISO 3166-1 alpha-2 set, deduplicated and sorted", () => {
    const markets = listIsoMarkets();
    expect(markets.length).toBeGreaterThanOrEqual(240);
    expect(new Set(markets.map((entry) => entry.market)).size).toBe(markets.length);
    expect(markets.map((entry) => entry.market)).toEqual(
      [...markets.map((entry) => entry.market)].sort(),
    );
    for (const code of ["US", "GB", "DE", "IN", "BR", "JP", "ZA"]) {
      expect(markets.some((entry) => entry.market === code)).toBe(true);
    }
  });

  it("has an English display name for every market", () => {
    for (const { market, name } of listIsoMarkets()) {
      expect(name.length).toBeGreaterThan(0);
      expect(name).not.toBe(market.toLowerCase());
    }
  });
});

describe("buildMarketSeeds", () => {
  it("blocks every market in production, including the US", () => {
    const rows = buildMarketSeeds("production", NOW);
    expect(rows.length).toBe(listIsoMarkets().length);
    for (const row of rows) {
      expect(row.serviceClass).toBe("blocked");
      expect(row.matchingEnabled).toBe(false);
      expect(row.monetizationEnabled).toBe(false);
      expect(row.reportingAuthority).toBe("pending_legal");
      expect(row.legalSignoffRef).toBeNull();
      expect(row.moderatorCoverage).toBe(false);
      expect(row.primaryLanguages).toEqual([]);
    }
  });

  it("enables exactly one fixture market in development", () => {
    const rows = buildMarketSeeds("development", NOW);
    const enabled = rows.filter((row) => row.serviceClass !== "blocked");
    expect(enabled).toHaveLength(1);

    const fixture = enabled[0]!;
    expect(fixture.market).toBe(DEV_FIXTURE_MARKET);
    expect(fixture.serviceClass).toBe("limited");
    expect(fixture.monetizationEnabled).toBe(false);
    expect(fixture.matchingEnabled).toBe(true);
    expect(fixture.legalSignoffRef).toBe(DEV_FIXTURE_SIGNOFF);
    expect(fixture.legalSignoffRef).toContain("NOT-A-LEGAL-SIGNOFF");
  });

  it("never enables a market in the production seed", () => {
    const decisions = buildMarketSeeds("production", NOW).map((row) =>
      evaluateMarketPolicy(row, NOW),
    );
    expect(decisions.every((decision) => !decision.enabled)).toBe(true);
  });

  it("produces rows that the runtime resolver agrees with", () => {
    expect(() => assertSeedInvariants(buildMarketSeeds("production", NOW), NOW)).not.toThrow();
    expect(() => assertSeedInvariants(buildMarketSeeds("development", NOW), NOW)).not.toThrow();
  });
});

describe("assertSeedInvariants", () => {
  it("rejects duplicate markets", () => {
    const rows = buildMarketSeeds("production", NOW);
    const duplicate = [...rows, rows[0]!];
    expect(() => assertSeedInvariants(duplicate, NOW)).toThrow(/duplicate seed row/);
  });

  it("rejects an enabled row that would resolve as blocked", () => {
    const rows = buildMarketSeeds("development", NOW).map((row) =>
      row.market === DEV_FIXTURE_MARKET ? { ...row, legalSignoffRef: null } : row,
    );
    expect(() => assertSeedInvariants(rows, NOW)).toThrow(/resolves as blocked/);
  });

  it("rejects an empty seed", () => {
    expect(() => assertSeedInvariants([] as MarketSeedRow[], NOW)).toThrow(/empty/);
  });
});
