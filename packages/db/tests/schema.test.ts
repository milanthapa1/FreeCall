import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "../src/schema/index";

/**
 * The table list is deliberate: adding or removing a table changes the migration surface
 * and must be a reviewed diff, not an accident. Keep this list in sync with
 * docs/data-model.md.
 */
const TABLES = {
  users: schema.users,
  sessions: schema.sessions,
  profiles: schema.profiles,
  ageVerifications: schema.ageVerifications,
  devices: schema.devices,
  ipReputation: schema.ipReputation,
  trustScores: schema.trustScores,
  blocks: schema.blocks,
  moderationEvents: schema.moderationEvents,
  reports: schema.reports,
  bans: schema.bans,
  banAppeals: schema.banAppeals,
  auditLogs: schema.auditLogs,
  calls: schema.calls,
  friendships: schema.friendships,
  friendRequests: schema.friendRequests,
  messagesDm: schema.messagesDm,
  coinLedger: schema.coinLedger,
  subscriptions: schema.subscriptions,
  stripeEvents: schema.stripeEvents,
  featureFlags: schema.featureFlags,
  marketPolicies: schema.marketPolicies,
};

describe("schema", () => {
  it("exports exactly the reviewed MVP tables", () => {
    expect(Object.keys(TABLES).sort()).toEqual(
      [
        "ageVerifications",
        "auditLogs",
        "banAppeals",
        "bans",
        "blocks",
        "calls",
        "coinLedger",
        "devices",
        "featureFlags",
        "friendRequests",
        "friendships",
        "ipReputation",
        "marketPolicies",
        "messagesDm",
        "moderationEvents",
        "profiles",
        "reports",
        "sessions",
        "stripeEvents",
        "subscriptions",
        "trustScores",
        "users",
      ].sort(),
    );
  });

  it("uses snake_case table names", () => {
    for (const table of Object.values(TABLES)) {
      expect(getTableName(table)).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it("enforces safety invariants on market policies in the database", () => {
    const checks = getTableConfig(schema.marketPolicies).checks.map((check) => check.name);
    expect(checks).toEqual(
      expect.arrayContaining([
        "market_policies_iso2",
        "market_policies_enabled_requires_signoff",
        "market_policies_enabled_requires_moderation_coverage",
        "market_policies_enabled_requires_reporting_authority",
        "market_policies_enabled_requires_age_assurance",
        "market_policies_blocked_cannot_match_or_monetize",
        "market_policies_limited_cannot_monetize",
      ]),
    );
  });

  it("guards the ban and report hot paths with the documented indexes", () => {
    const banIndexes = getTableConfig(schema.bans).indexes.map((index) => index.config.name);
    expect(banIndexes).toEqual(
      expect.arrayContaining(["bans_one_active_permanent_per_scope", "bans_appeal_queue_idx"]),
    );

    const reportIndexes = getTableConfig(schema.reports).indexes.map((index) => index.config.name);
    expect(reportIndexes).toEqual(
      expect.arrayContaining(["reports_call_reporter_unique", "reports_queue_idx"]),
    );
  });

  it("does not allow a block or friendship against yourself", () => {
    const blockChecks = getTableConfig(schema.blocks).checks.map((check) => check.name);
    expect(blockChecks).toContain("blocks_not_self");
    const friendshipChecks = getTableConfig(schema.friendships).checks.map((check) => check.name);
    expect(friendshipChecks).toContain("friendships_canonical_order");
  });
});

/**
 * Migrations are generated artifacts. This test fails if someone changes the schema but
 * forgets to run `npm run db:generate`, or if the hand-written `updated_at` trigger
 * migration disappears.
 */
describe("migrations", () => {
  const directory = fileURLToPath(new URL("../drizzle", import.meta.url));
  const files = readdirSync(directory).filter((file) => file.endsWith(".sql"));
  const sql = files.map((file) => readFileSync(join(directory, file), "utf8")).join("\n");

  it("contains a generated table migration for the full schema", () => {
    for (const table of ["users", "market_policies", "calls", "coin_ledger", "audit_logs"]) {
      expect(sql).toMatch(new RegExp(`CREATE TABLE "${table}"`, "i"));
    }
  });

  it("creates the updated_at trigger function and attaches it", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION set_updated_at/i);
    expect(sql).toMatch(/CREATE TRIGGER set_updated_at/i);
  });

  it("is tracked in the drizzle journal", () => {
    const journal = JSON.parse(
      readFileSync(join(directory, "meta", "_journal.json"), "utf8"),
    ) as { entries: unknown[] };
    expect(journal.entries.length).toBeGreaterThanOrEqual(2);
    expect(files.length).toBeGreaterThanOrEqual(2);
  });
});
