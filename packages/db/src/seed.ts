import { marketPolicies } from "./schema/ops";
import { createDb } from "./client";
import { loadDotenv } from "./dotenv";
import { loadDbEnv } from "./env";
import {
  DEV_FIXTURE_MARKET,
  DEV_FIXTURE_SIGNOFF,
  assertSeedInvariants,
  buildMarketSeeds,
  type SeedMode,
} from "./seed-data";

/**
 * Idempotent seed.
 *
 * - `production` mode inserts only rows that do not exist. It never rewrites an existing
 *   policy, because enabling/disabling a market is a reviewed data change.
 * - `development`/`test` additionally upserts the single US fixture market.
 */
async function main(): Promise<void> {
  loadDotenv();
  const env = loadDbEnv();
  const mode: SeedMode = env.NODE_ENV === "production" ? "production" : "development";
  const now = new Date();
  const rows = buildMarketSeeds(mode, now);
  assertSeedInvariants(rows, now);

  const fixture = mode === "development"
    ? rows.find((row) => row.market === DEV_FIXTURE_MARKET)
    : undefined;
  const baseline = rows.filter((row) => row.market !== fixture?.market);

  const handle = createDb(env.MIGRATE_DATABASE_URL ?? env.DATABASE_URL, {
    max: 1,
    applicationName: "freecall-seed",
    ssl: env.DB_SSL,
    connectTimeoutSeconds: env.DB_CONNECT_TIMEOUT_SECONDS,
  });

  try {
    const inserted = await handle.db
      .insert(marketPolicies)
      .values(baseline)
      .onConflictDoNothing({ target: marketPolicies.market })
      .returning({ market: marketPolicies.market });

    let fixtureUpdated = false;
    if (fixture) {
      const { market, ...set } = fixture;
      await handle.db
        .insert(marketPolicies)
        .values(fixture)
        .onConflictDoUpdate({ target: marketPolicies.market, set });
      fixtureUpdated = true;
      console.warn(
        `WARNING: applied development fixture for ${market} with sign-off "${DEV_FIXTURE_SIGNOFF}". This market must never be enabled this way in production.`,
      );
    }

    console.log(
      `market_policies seeded: mode=${mode}, inserted=${inserted.length}, existing=${baseline.length - inserted.length}, fixtureUpdated=${fixtureUpdated}`,
    );
    if (mode === "production") {
      console.log("all markets are blocked unless a reviewed policy row already exists");
    }
  } finally {
    await handle.close({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error(`seed failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
