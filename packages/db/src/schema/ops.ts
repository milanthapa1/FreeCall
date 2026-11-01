import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { ageTier, residency, serviceClass } from "./enums";

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const featureFlags = pgTable(
  "feature_flags",
  {
    key: text("key").primaryKey(),
    enabled: boolean("enabled").notNull().default(false),
    rollout: jsonb("rollout").notNull().default(sql`'{}'::jsonb`),
    updatedBy: text("updated_by"),
    createdAt,
    updatedAt,
  },
  (table) => [
    check("feature_flags_key_present", sql`length(btrim(${table.key})) > 0`),
    check("feature_flags_rollout_object", sql`jsonb_typeof(${table.rollout}) = 'object'`),
  ],
);

/**
 * One row per ISO 3166-1 alpha-2 market. A *missing* row is treated as `blocked`;
 * absence is not a default-allow (ADR-0018).
 *
 * The CHECK constraints below encode launch gates that must never be bypassed by a
 * buggy admin write:
 *  - an enabled market has a legal sign-off reference and a named signer;
 *  - an enabled market has 24/7 moderator coverage;
 *  - an enabled market has a concrete CSAM reporting authority (never `pending_legal`);
 *  - an enabled market requires at least estimated age (never self-declaration alone);
 *  - `blocked` and `limited` markets cannot monetize, and `blocked` cannot match.
 *
 * Changing these is a reviewed migration, which is the point: policy is data, but the
 * safety invariants around that data live in the schema.
 */
export const marketPolicies = pgTable(
  "market_policies",
  {
    market: text("market").primaryKey(),
    serviceClass: serviceClass("service_class").notNull().default("blocked"),
    requiredAgeTier: ageTier("required_age_tier").notNull().default("t1_estimated"),
    guestMinutesPerDay: integer("guest_minutes_per_day").notNull().default(0),
    monetizationEnabled: boolean("monetization_enabled").notNull().default(false),
    matchingEnabled: boolean("matching_enabled").notNull().default(false),
    residency: residency("residency").notNull().default("global"),
    retentionDays: integer("retention_days").notNull().default(30),
    /** `ncmec`, `both`, `national:<ISO>` or `pending_legal`. */
    reportingAuthority: text("reporting_authority").notNull().default("pending_legal"),
    primaryLanguages: text("primary_languages").array().notNull().default(sql`'{}'::text[]`),
    moderatorCoverage: boolean("moderator_coverage").notNull().default(false),
    legalSignoffRef: text("legal_signoff_ref"),
    signer: text("signer"),
    policyVersion: integer("policy_version").notNull().default(1),
    effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull().defaultNow(),
    changelog: text("changelog"),
    createdAt,
    updatedAt,
  },
  (table) => [
    check("market_policies_iso2", sql`${table.market} ~ '^[A-Z]{2}$'`),
    check("market_policies_guest_minutes", sql`${table.guestMinutesPerDay} >= 0`),
    check("market_policies_retention_positive", sql`${table.retentionDays} > 0`),
    check("market_policies_version_positive", sql`${table.policyVersion} > 0`),
    check(
      "market_policies_languages_format",
      sql`cardinality(${table.primaryLanguages}) = 0 or array_to_string(${table.primaryLanguages}, ',') ~ '^[a-z]{2}(,[a-z]{2})*$'`,
    ),
    check(
      "market_policies_reporting_authority_format",
      sql`${table.reportingAuthority} ~ '^(ncmec|both|pending_legal|national:[A-Z]{2})$'`,
    ),
    check(
      "market_policies_enabled_requires_signoff",
      sql`${table.serviceClass} = 'blocked' or (${table.legalSignoffRef} is not null and length(btrim(${table.legalSignoffRef})) > 0 and ${table.signer} is not null and length(btrim(${table.signer})) > 0)`,
    ),
    check(
      "market_policies_enabled_requires_moderation_coverage",
      sql`${table.serviceClass} = 'blocked' or ${table.moderatorCoverage}`,
    ),
    check(
      "market_policies_enabled_requires_reporting_authority",
      sql`${table.serviceClass} = 'blocked' or ${table.reportingAuthority} in ('ncmec', 'both') or ${table.reportingAuthority} like 'national:%'`,
    ),
    check(
      "market_policies_enabled_requires_age_assurance",
      sql`${table.serviceClass} = 'blocked' or ${table.requiredAgeTier} <> 't0_declared'`,
    ),
    check(
      "market_policies_blocked_cannot_match_or_monetize",
      sql`${table.serviceClass} <> 'blocked' or (${table.matchingEnabled} = false and ${table.monetizationEnabled} = false)`,
    ),
    check(
      "market_policies_limited_cannot_monetize",
      sql`${table.serviceClass} <> 'limited' or ${table.monetizationEnabled} = false`,
    ),
  ],
);
