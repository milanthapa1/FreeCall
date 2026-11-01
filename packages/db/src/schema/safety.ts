import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  appealState,
  appealStatus,
  banScope,
  banSource,
  moderationSource,
  reportSeverity,
  reportStatus,
  userRole,
} from "./enums";
import { users } from "./identity";

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

/**
 * Append-only moderation signal log. A correction is a new row with `source = 'human'`;
 * rows are never updated in place. `call_id` intentionally has no FK: `calls` is written
 * asynchronously and will be partitioned, while this table must accept a signal even if
 * the call row has not landed yet.
 */
export const moderationEvents = pgTable(
  "moderation_events",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    callId: uuid("call_id"),
    source: moderationSource("source").notNull(),
    label: text("label").notNull(),
    score: numeric("score", { precision: 5, scale: 4 }),
    model: text("model"),
    modelVersion: text("model_version"),
    policyVersion: text("policy_version").notNull(),
    actionTaken: text("action_taken").notNull().default("none"),
    frameRef: text("frame_ref"),
    createdAt,
  },
  (table) => [
    check(
      "moderation_events_score_range",
      sql`${table.score} is null or (${table.score} >= 0 and ${table.score} <= 1)`,
    ),
    check(
      "moderation_events_action_allowed",
      sql`${table.actionTaken} in ('none', 'warn', 'blur', 'disconnect', 'restrict', 'temp_ban', 'permanent_ban', 'escalate')`,
    ),
    index("moderation_events_user_idx").on(table.userId, table.createdAt.desc()),
    index("moderation_events_call_idx").on(table.callId),
    index("moderation_events_label_idx").on(table.label, table.createdAt.desc()),
    index("moderation_events_action_idx")
      .on(table.actionTaken)
      .where(sql`${table.actionTaken} <> 'none'`),
  ],
);

export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey(),
    callId: uuid("call_id").notNull(),
    reporterId: uuid("reporter_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    reportedId: uuid("reported_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    reason: text("reason").notNull(),
    note: text("note"),
    status: reportStatus("status").notNull().default("open"),
    severity: reportSeverity("severity").notNull().default("medium"),
    /**
     * Pointer into the restricted evidence bucket. The object key itself is not a secret,
     * but the bucket is private and access requires a break-glass grant.
     */
    evidenceManifestKey: text("evidence_manifest_key"),
    evidenceSha256: text("evidence_sha256"),
    moderatorId: uuid("moderator_id").references(() => users.id, { onDelete: "restrict" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    check(
      "reports_reason_allowed",
      sql`${table.reason} in ('nudity', 'minor', 'violence', 'harassment', 'spam', 'scam', 'ncii', 'other')`,
    ),
    check("reports_note_length", sql`${table.note} is null or char_length(${table.note}) <= 500`),
    check(
      "reports_evidence_sha256_format",
      sql`${table.evidenceSha256} is null or ${table.evidenceSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check("reports_not_self", sql`${table.reporterId} <> ${table.reportedId}`),
    uniqueIndex("reports_call_reporter_unique").on(table.callId, table.reporterId),
    index("reports_queue_idx").on(table.status, table.severity, table.createdAt),
    index("reports_recidivism_idx").on(table.reportedId, table.createdAt.desc()),
    index("reports_call_idx").on(table.callId),
  ],
);

/**
 * Bans are never deleted. Revocation and expiration are state, corrections are new rows.
 * The realtime ban check is cached in Redis; Postgres is the source of truth.
 */
export const bans = pgTable(
  "bans",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    scope: banScope("scope").notNull(),
    reasonCode: text("reason_code").notNull(),
    note: text("note"),
    issuedBy: banSource("issued_by").notNull(),
    issuedById: uuid("issued_by_id").references(() => users.id, { onDelete: "restrict" }),
    evidenceCaseId: uuid("evidence_case_id"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    appealStatus: appealStatus("appeal_status").notNull().default("none"),
    createdAt,
    updatedAt,
  },
  (table) => [
    check("bans_reason_code_present", sql`length(btrim(${table.reasonCode})) > 0`),
    check(
      "bans_expiry_after_start",
      sql`${table.expiresAt} is null or ${table.expiresAt} > ${table.startsAt}`,
    ),
    check(
      "bans_system_has_no_issuer",
      sql`${table.issuedBy} <> 'system' or ${table.issuedById} is null`,
    ),
    check(
      "bans_moderator_has_issuer",
      sql`${table.issuedBy} <> 'moderator' or ${table.issuedById} is not null`,
    ),
    index("bans_user_idx").on(table.userId, table.expiresAt.desc()),
    uniqueIndex("bans_one_active_permanent_per_scope")
      .on(table.userId, table.scope)
      .where(sql`${table.revokedAt} is null and ${table.expiresAt} is null`),
    index("bans_appeal_queue_idx")
      .on(table.appealStatus)
      .where(sql`${table.appealStatus} = 'requested'`),
  ],
);

export const banAppeals = pgTable(
  "ban_appeals",
  {
    id: uuid("id").primaryKey(),
    banId: uuid("ban_id")
      .notNull()
      .references(() => bans.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    statement: text("statement").notNull(),
    status: appealState("status").notNull().default("submitted"),
    reviewerId: uuid("reviewer_id").references(() => users.id, { onDelete: "restrict" }),
    decisionNote: text("decision_note"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    check(
      "ban_appeals_statement_length",
      sql`char_length(${table.statement}) between 1 and 2000`,
    ),
    uniqueIndex("ban_appeals_ban_unique").on(table.banId),
    index("ban_appeals_queue_idx").on(table.status, table.createdAt),
  ],
);

/**
 * Admin audit trail. `before`/`after` payloads are redacted by the caller, never raw PII.
 * Partitioned monthly in a later migration; retained 24 months (docs/privacy.md).
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "restrict" }),
    actorRole: userRole("actor_role"),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    reasonCode: text("reason_code"),
    ipHash: text("ip_hash"),
    requestId: text("request_id"),
    createdAt,
  },
  (table) => [
    check("audit_logs_action_present", sql`length(btrim(${table.action})) > 0`),
    index("audit_logs_target_idx").on(table.targetType, table.targetId, table.createdAt.desc()),
    index("audit_logs_actor_idx").on(table.actorId, table.createdAt.desc()),
    index("audit_logs_action_idx").on(table.action, table.createdAt.desc()),
  ],
);
