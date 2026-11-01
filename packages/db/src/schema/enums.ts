import { pgEnum } from "drizzle-orm/pg-core";

/*
 * Enums are only for value sets that are stable and reviewed by policy. Reason codes,
 * moderation actions and reporting authorities are `text` + `CHECK` instead, because
 * adding a value there must not require an enum type migration (see docs/data-model.md).
 */

export const userRole = pgEnum("user_role", [
  "user",
  "moderator",
  "senior_reviewer",
  "legal",
  "auditor",
  "admin",
]);

export const userStatus = pgEnum("user_status", ["active", "suspended", "locked", "deleted"]);

export const ageTier = pgEnum("age_tier", [
  "t0_declared",
  "t1_estimated",
  "t2_verified",
  "t3_locked",
]);

export const sessionAudience = pgEnum("session_audience", ["user", "admin"]);

export const verificationStatus = pgEnum("verification_status", [
  "pending",
  "passed",
  "failed",
  "expired",
  "revoked",
]);

export const moderationSource = pgEnum("moderation_source", [
  "visual",
  "text",
  "report",
  "heuristic",
  "human",
]);

export const reportStatus = pgEnum("report_status", [
  "open",
  "evidence_pending",
  "in_review",
  "actioned",
  "dismissed",
  "escalated",
]);

export const reportSeverity = pgEnum("report_severity", ["low", "medium", "high", "critical"]);

export const banScope = pgEnum("ban_scope", ["call", "dm", "upload", "platform"]);

export const banSource = pgEnum("ban_source", ["system", "moderator"]);

export const appealStatus = pgEnum("appeal_status", ["none", "requested", "upheld", "overturned"]);

export const appealState = pgEnum("appeal_state", [
  "submitted",
  "in_review",
  "upheld",
  "overturned",
]);

export const callEndReason = pgEnum("call_end_reason", [
  "skip",
  "stop",
  "disconnect",
  "setup_timeout",
  "enforcement",
  "error",
  "partner_left",
]);

/**
 * `solo_couple` is a couple call where one side is a solo account in a couple room.
 * The wire protocol collapses it to `couple`; the database keeps the distinction for
 * moderation analytics.
 */
export const callMode = pgEnum("call_mode", ["solo", "solo_couple", "couple"]);

export const trustBand = pgEnum("trust_band", ["low", "normal", "high"]);

export const friendRequestStatus = pgEnum("friend_request_status", [
  "pending",
  "accepted",
  "declined",
  "cancelled",
  "expired",
]);

export const coinReason = pgEnum("coin_reason", [
  "purchase",
  "daily_grant",
  "spend_priority",
  "spend_filter",
  "spend_hd",
  "refund",
  "chargeback",
  "admin_adjust",
]);

export const subscriptionStatus = pgEnum("subscription_status", [
  "active",
  "trialing",
  "past_due",
  "canceled",
  "incomplete",
  "unpaid",
]);

export const serviceClass = pgEnum("service_class", ["full", "strict", "limited", "blocked"]);

/**
 * Residency values that Phase 0 can actually provision. Other legal residencies fail
 * closed (`blocked`) until an operator stands up the stack (ADR-0018 §4).
 */
export const residency = pgEnum("residency", ["global", "eu"]);
