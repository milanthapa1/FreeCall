import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { callEndReason, callMode } from "./enums";
import { users } from "./identity";

/**
 * A finished (or in-flight) call. Written asynchronously by the worker at call end, keyed
 * by the id the realtime layer generated for the match, so retries are idempotent.
 * There is deliberately no row per match attempt: queueing and failed setup live in metrics.
 *
 * Phase 0 keeps this unpartitioned. The production migration partitions by `started_at`
 * monthly; that is a hand-written migration because Drizzle cannot emit partitions.
 */
export const calls = pgTable(
  "calls",
  {
    id: uuid("id").primaryKey(),
    aUserId: uuid("a_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    bUserId: uuid("b_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    region: text("region").notNull(),
    mode: callMode("mode").notNull(),
    langA: text("lang_a").notNull(),
    langB: text("lang_b").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endReason: callEndReason("end_reason"),
    connectMs: integer("connect_ms"),
    samplingTier: text("sampling_tier").notNull().default("client"),
    policyVersion: text("policy_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("calls_distinct_users", sql`${table.aUserId} <> ${table.bUserId}`),
    check(
      "calls_connect_ms_nonnegative",
      sql`${table.connectMs} is null or ${table.connectMs} >= 0`,
    ),
    check(
      "calls_end_after_start",
      sql`${table.endedAt} is null or ${table.endedAt} >= ${table.startedAt}`,
    ),
    check(
      "calls_sampling_tier_allowed",
      sql`${table.samplingTier} in ('none', 'client', 'server', 'elevated', 'report')`,
    ),
    index("calls_a_user_idx").on(table.aUserId, table.startedAt.desc()),
    index("calls_b_user_idx").on(table.bUserId, table.startedAt.desc()),
    index("calls_region_idx").on(table.region, table.startedAt.desc()),
    index("calls_unended_idx").on(table.endedAt).where(sql`${table.endedAt} is null`),
  ],
);
