import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { ageTier, sessionAudience, trustBand, userRole, userStatus, verificationStatus } from "./enums";

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    email: text("email"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    isAnonymous: boolean("is_anonymous").notNull().default(false),
    role: userRole("role").notNull().default("user"),
    status: userStatus("status").notNull().default("active"),
    ageTier: ageTier("age_tier").notNull().default("t0_declared"),
    market: text("market").notNull(),
    trustScore: smallint("trust_score").notNull().default(50),
    coinBalance: integer("coin_balance").notNull().default(0),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("users_email_unique")
      .on(table.email)
      .where(sql`${table.email} is not null`),
    index("users_status_idx")
      .on(table.status)
      .where(sql`${table.status} <> 'active'`),
    index("users_guest_cleanup_idx")
      .on(table.isAnonymous, table.lastSeenAt)
      .where(sql`${table.isAnonymous} = true`),
    index("users_created_at_idx").on(table.createdAt),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    tokenHash: text("token_hash").notNull(),
    audience: sessionAudience("audience").notNull().default("user"),
    ipHash: text("ip_hash"),
    deviceId: uuid("device_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    idleExpiresAt: timestamp("idle_expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("sessions_token_hash_unique").on(table.tokenHash),
    index("sessions_user_idx").on(table.userId, table.createdAt),
    index("sessions_expiry_idx").on(table.expiresAt),
  ],
);

export const profiles = pgTable(
  "profiles",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "restrict" }),
    displayName: text("display_name"),
    bio: text("bio"),
    avatarPublicId: text("avatar_public_id"),
    interests: text("interests").array().notNull().default(sql`'{}'::text[]`),
    gender: text("gender"),
    lookingFor: text("looking_for"),
    createdAt,
    updatedAt,
  },
  (table) => [index("profiles_interests_idx").using("gin", table.interests)],
);

export const ageVerifications = pgTable(
  "age_verifications",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    provider: text("provider").notNull(),
    providerRef: text("provider_ref").notNull(),
    status: verificationStatus("status").notNull().default("pending"),
    tier: ageTier("tier").notNull(),
    ageBand: text("age_band"),
    decisionHash: text("decision_hash"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("age_verifications_provider_ref_unique").on(table.provider, table.providerRef),
    index("age_verifications_user_idx").on(table.userId, table.createdAt),
    index("age_verifications_expiry_idx").on(table.status, table.expiresAt),
  ],
);

export const devices = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    fingerprintHash: text("fingerprint_hash").notNull(),
    uaFamily: text("ua_family"),
    riskFlags: text("risk_flags").array().notNull().default(sql`'{}'::text[]`),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("devices_fingerprint_unique").on(table.fingerprintHash),
    index("devices_user_idx").on(table.userId, table.lastSeenAt),
    index("devices_last_seen_idx").on(table.lastSeenAt),
  ],
);

export const ipReputation = pgTable(
  "ip_reputation",
  {
    ipHash: text("ip_hash").primaryKey(),
    asn: text("asn"),
    country: text("country"),
    score: smallint("score").notNull().default(0),
    signals: jsonb("signals").notNull().default(sql`'{}'::jsonb`),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("ip_reputation_high_risk_idx")
      .on(table.score)
      .where(sql`${table.score} > 70`),
    index("ip_reputation_expiry_idx").on(table.expiresAt),
  ],
);

export const trustScores = pgTable(
  "trust_scores",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "restrict" }),
    score: smallint("score").notNull().default(50),
    band: trustBand("band").notNull().default("normal"),
    components: jsonb("components").notNull().default(sql`'{}'::jsonb`),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt,
    updatedAt,
  },
  (table) => [index("trust_scores_band_idx").on(table.band)],
);

export const blocks = pgTable(
  "blocks",
  {
    blockerId: uuid("blocker_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    blockedId: uuid("blocked_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    reason: text("reason"),
    source: text("source").notNull().default("user"),
    createdAt,
  },
  (table) => [
    primaryKey({ columns: [table.blockerId, table.blockedId] }),
    check("blocks_not_self", sql`${table.blockerId} <> ${table.blockedId}`),
    check("blocks_source_allowed", sql`${table.source} in ('user', 'moderation')`),
    index("blocks_blocked_idx").on(table.blockedId),
    index("blocks_created_at_idx").on(table.createdAt),
  ],
);
