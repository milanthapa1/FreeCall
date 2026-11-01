import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { coinReason, subscriptionStatus } from "./enums";
import { users } from "./identity";

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

/**
 * Append-only coin ledger. The application role has INSERT/SELECT only; there is no
 * UPDATE or DELETE grant (enforced by a migration, not by Drizzle). `users.coin_balance`
 * is a cache reconciled nightly and is never trusted for authorization.
 */
export const coinLedger = pgTable(
  "coin_ledger",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    delta: integer("delta").notNull(),
    reason: coinReason("reason").notNull(),
    refType: text("ref_type"),
    refId: text("ref_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "restrict" }),
    createdAt,
  },
  (table) => [
    check("coin_ledger_delta_nonzero", sql`${table.delta} <> 0`),
    check(
      "coin_ledger_idempotency_key_present",
      sql`length(btrim(${table.idempotencyKey})) > 0`,
    ),
    uniqueIndex("coin_ledger_idempotency_unique").on(table.idempotencyKey),
    index("coin_ledger_user_idx").on(table.userId, table.createdAt.desc()),
  ],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    stripeCustomerId: text("stripe_customer_id").notNull(),
    stripeSubscriptionId: text("stripe_subscription_id").notNull(),
    plan: text("plan").notNull(),
    status: subscriptionStatus("status").notNull(),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("subscriptions_stripe_id_unique").on(table.stripeSubscriptionId),
    index("subscriptions_user_idx").on(table.userId, table.status),
    index("subscriptions_period_end_idx").on(table.currentPeriodEnd),
  ],
);

/**
 * Stripe webhook dedupe and replay diagnostics. `processed_at` is null until handling
 * succeeds; a non-null `error` means the event was seen but failed and needs replay.
 */
export const stripeEvents = pgTable(
  "stripe_events",
  {
    eventId: text("event_id").primaryKey(),
    type: text("type").notNull(),
    payloadSha256: text("payload_sha256").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    error: text("error"),
  },
  (table) => [
    check(
      "stripe_events_payload_sha256_format",
      sql`${table.payloadSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    index("stripe_events_unprocessed_idx")
      .on(table.receivedAt)
      .where(sql`${table.processedAt} is null`),
  ],
);
