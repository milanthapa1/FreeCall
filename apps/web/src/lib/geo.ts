import {
  createDb,
  evaluateMarketPolicy,
  marketPolicies,
  normalizeMarket,
  type MarketDecision,
} from "@freecall/db";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { getWebEnv } from "./server-env";

/** TTL for the in-process market policy cache (30 seconds). */
const CACHE_TTL_MS = 30_000;

interface CachedPolicy {
  decision: MarketDecision;
  cachedAt: number;
}

const policyCache = new Map<string, CachedPolicy>();

/**
 * Look up a market policy from the database with a 30-second in-process cache.
 *
 * Falls closed on any error: a DB failure returns a `missing_policy_row` decision
 * rather than throwing, so a database hiccup does not expose a default-allow path.
 * The market is always resolved from trusted server-side headers; the client cannot
 * influence this value (ADR-0018).
 */
async function resolveMarketPolicy(marketCode: string): Promise<MarketDecision> {
  const now = Date.now();
  const cached = policyCache.get(marketCode);
  if (cached && now - cached.cachedAt < CACHE_TTL_MS) {
    return cached.decision;
  }

  try {
    const env = getWebEnv();
    const { db, close } = createDb(env.DATABASE_URL, {
      max: 1,
      connectTimeoutSeconds: 3,
      applicationName: "freecall-web-geo",
    });

    let decision: MarketDecision;
    try {
      const [row] = await db
        .select()
        .from(marketPolicies)
        .where(eq(marketPolicies.market, marketCode))
        .limit(1);

      // If row exists, map DB row to MarketPolicy shape for evaluation.
      if (row) {
        decision = evaluateMarketPolicy({
          market: row.market,
          serviceClass: row.serviceClass,
          requiredAgeTier: row.requiredAgeTier,
          guestMinutesPerDay: row.guestMinutesPerDay,
          monetizationEnabled: row.monetizationEnabled,
          matchingEnabled: row.matchingEnabled,
          residency: row.residency,
          retentionDays: row.retentionDays,
          reportingAuthority: row.reportingAuthority,
          primaryLanguages: row.primaryLanguages,
          moderatorCoverage: row.moderatorCoverage,
          legalSignoffRef: row.legalSignoffRef ?? null,
          signer: row.signer ?? null,
          policyVersion: row.policyVersion,
          effectiveAt: row.effectiveAt,
        });
      } else {
        // No row = blocked (fail-closed per ADR-0018).
        decision = evaluateMarketPolicy(null);
      }
    } finally {
      await close({ timeout: 2 }).catch(() => undefined);
    }

    policyCache.set(marketCode, { decision, cachedAt: now });
    return decision;
  } catch {
    // Any error — missing env, DB timeout, parse failure — falls back to
    // the dev fixture in development so `npm run dev` works without a live DB,
    // and returns blocked in every other environment (fail-closed per ADR-0018).
    if (process.env["NODE_ENV"] === "development") {
      return devFixtureDecision(marketCode);
    }
    return evaluateMarketPolicy(null);
  }
}

/** In-process dev fixture used when the DB is unreachable in development. */
function devFixtureDecision(marketCode: string): MarketDecision {
  // Only allow the one explicitly seeded dev market. Everything else: blocked.
  if (marketCode !== "US") {
    return evaluateMarketPolicy(null);
  }
  return {
    market: "US",
    serviceClass: "limited",
    enabled: true,
    matchingEnabled: true,
    monetizationEnabled: false,
    requiredAgeTier: "t1_estimated",
    guestMinutesPerDay: 30,
    residency: "global",
    retentionDays: 30,
    reportingAuthority: "both",
    policyVersion: 1,
    reasons: [],
  };
}

/**
 * Resolves the requesting market from trusted edge headers.
 *
 * Priority:
 * 1. `cf-ipcountry`  — Cloudflare header, set at edge (cannot be spoofed at origin).
 * 2. `x-geo-country` — Vercel/other CDN header.
 * 3. `NODE_ENV=development` → `"US"` dev fixture only (never in production).
 *
 * The resolved code is then looked up in the `market_policies` table; no client-supplied
 * field can change this result.
 */
export async function getResolvedMarket(
  incomingHeaders?: Headers | null,
): Promise<{
  marketCode: string;
  decision: MarketDecision;
}> {
  let headerList = incomingHeaders;
  if (!headerList) {
    try {
      headerList = await headers();
    } catch {
      headerList = null;
    }
  }

  const rawCountry =
    headerList?.get("cf-ipcountry") ??
    headerList?.get("x-geo-country") ??
    (process.env["NODE_ENV"] === "development" ? "US" : null);

  const marketCode = normalizeMarket(rawCountry) ?? "ZZ";
  const decision = await resolveMarketPolicy(marketCode);

  return { marketCode, decision };
}
