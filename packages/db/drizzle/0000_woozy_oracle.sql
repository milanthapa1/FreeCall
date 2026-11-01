CREATE TYPE "public"."age_tier" AS ENUM('t0_declared', 't1_estimated', 't2_verified', 't3_locked');--> statement-breakpoint
CREATE TYPE "public"."appeal_state" AS ENUM('submitted', 'in_review', 'upheld', 'overturned');--> statement-breakpoint
CREATE TYPE "public"."appeal_status" AS ENUM('none', 'requested', 'upheld', 'overturned');--> statement-breakpoint
CREATE TYPE "public"."ban_scope" AS ENUM('call', 'dm', 'upload', 'platform');--> statement-breakpoint
CREATE TYPE "public"."ban_source" AS ENUM('system', 'moderator');--> statement-breakpoint
CREATE TYPE "public"."call_end_reason" AS ENUM('skip', 'stop', 'disconnect', 'setup_timeout', 'enforcement', 'error', 'partner_left');--> statement-breakpoint
CREATE TYPE "public"."call_mode" AS ENUM('solo', 'solo_couple', 'couple');--> statement-breakpoint
CREATE TYPE "public"."coin_reason" AS ENUM('purchase', 'daily_grant', 'spend_priority', 'spend_filter', 'spend_hd', 'refund', 'chargeback', 'admin_adjust');--> statement-breakpoint
CREATE TYPE "public"."friend_request_status" AS ENUM('pending', 'accepted', 'declined', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."moderation_source" AS ENUM('visual', 'text', 'report', 'heuristic', 'human');--> statement-breakpoint
CREATE TYPE "public"."report_severity" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('open', 'evidence_pending', 'in_review', 'actioned', 'dismissed', 'escalated');--> statement-breakpoint
CREATE TYPE "public"."residency" AS ENUM('global', 'eu');--> statement-breakpoint
CREATE TYPE "public"."service_class" AS ENUM('full', 'strict', 'limited', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."session_audience" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('active', 'trialing', 'past_due', 'canceled', 'incomplete', 'unpaid');--> statement-breakpoint
CREATE TYPE "public"."trust_band" AS ENUM('low', 'normal', 'high');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'moderator', 'senior_reviewer', 'legal', 'auditor', 'admin');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'suspended', 'locked', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('pending', 'passed', 'failed', 'expired', 'revoked');--> statement-breakpoint
CREATE TABLE "age_verifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text NOT NULL,
	"status" "verification_status" DEFAULT 'pending' NOT NULL,
	"tier" "age_tier" NOT NULL,
	"age_band" text,
	"decision_hash" text,
	"verified_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blocks" (
	"blocker_id" uuid NOT NULL,
	"blocked_id" uuid NOT NULL,
	"reason" text,
	"source" text DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blocks_blocker_id_blocked_id_pk" PRIMARY KEY("blocker_id","blocked_id"),
	CONSTRAINT "blocks_not_self" CHECK ("blocks"."blocker_id" <> "blocks"."blocked_id"),
	CONSTRAINT "blocks_source_allowed" CHECK ("blocks"."source" in ('user', 'moderation'))
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"fingerprint_hash" text NOT NULL,
	"ua_family" text,
	"risk_flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ip_reputation" (
	"ip_hash" text PRIMARY KEY NOT NULL,
	"asn" text,
	"country" text,
	"score" smallint DEFAULT 0 NOT NULL,
	"signals" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"display_name" text,
	"bio" text,
	"avatar_public_id" text,
	"interests" text[] DEFAULT '{}'::text[] NOT NULL,
	"gender" text,
	"looking_for" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"audience" "session_audience" DEFAULT 'user' NOT NULL,
	"ip_hash" text,
	"device_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"idle_expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trust_scores" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"score" smallint DEFAULT 50 NOT NULL,
	"band" "trust_band" DEFAULT 'normal' NOT NULL,
	"components" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text,
	"email_verified_at" timestamp with time zone,
	"is_anonymous" boolean DEFAULT false NOT NULL,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"age_tier" "age_tier" DEFAULT 't0_declared' NOT NULL,
	"market" text NOT NULL,
	"trust_score" smallint DEFAULT 50 NOT NULL,
	"coin_balance" integer DEFAULT 0 NOT NULL,
	"last_seen_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid,
	"actor_role" "user_role",
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"before" jsonb,
	"after" jsonb,
	"reason_code" text,
	"ip_hash" text,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_logs_action_present" CHECK (length(btrim("audit_logs"."action")) > 0)
);
--> statement-breakpoint
CREATE TABLE "ban_appeals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ban_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"statement" text NOT NULL,
	"status" "appeal_state" DEFAULT 'submitted' NOT NULL,
	"reviewer_id" uuid,
	"decision_note" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ban_appeals_statement_length" CHECK (char_length("ban_appeals"."statement") between 1 and 2000)
);
--> statement-breakpoint
CREATE TABLE "bans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"scope" "ban_scope" NOT NULL,
	"reason_code" text NOT NULL,
	"note" text,
	"issued_by" "ban_source" NOT NULL,
	"issued_by_id" uuid,
	"evidence_case_id" uuid,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"appeal_status" "appeal_status" DEFAULT 'none' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bans_reason_code_present" CHECK (length(btrim("bans"."reason_code")) > 0),
	CONSTRAINT "bans_expiry_after_start" CHECK ("bans"."expires_at" is null or "bans"."expires_at" > "bans"."starts_at"),
	CONSTRAINT "bans_system_has_no_issuer" CHECK ("bans"."issued_by" <> 'system' or "bans"."issued_by_id" is null),
	CONSTRAINT "bans_moderator_has_issuer" CHECK ("bans"."issued_by" <> 'moderator' or "bans"."issued_by_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "moderation_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"call_id" uuid,
	"source" "moderation_source" NOT NULL,
	"label" text NOT NULL,
	"score" numeric(5, 4),
	"model" text,
	"model_version" text,
	"policy_version" text NOT NULL,
	"action_taken" text DEFAULT 'none' NOT NULL,
	"frame_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderation_events_score_range" CHECK ("moderation_events"."score" is null or ("moderation_events"."score" >= 0 and "moderation_events"."score" <= 1)),
	CONSTRAINT "moderation_events_action_allowed" CHECK ("moderation_events"."action_taken" in ('none', 'warn', 'blur', 'disconnect', 'restrict', 'temp_ban', 'permanent_ban', 'escalate'))
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"call_id" uuid NOT NULL,
	"reporter_id" uuid NOT NULL,
	"reported_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"status" "report_status" DEFAULT 'open' NOT NULL,
	"severity" "report_severity" DEFAULT 'medium' NOT NULL,
	"evidence_manifest_key" text,
	"evidence_sha256" text,
	"moderator_id" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reports_reason_allowed" CHECK ("reports"."reason" in ('nudity', 'minor', 'violence', 'harassment', 'spam', 'scam', 'ncii', 'other')),
	CONSTRAINT "reports_note_length" CHECK ("reports"."note" is null or char_length("reports"."note") <= 500),
	CONSTRAINT "reports_evidence_sha256_format" CHECK ("reports"."evidence_sha256" is null or "reports"."evidence_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "reports_not_self" CHECK ("reports"."reporter_id" <> "reports"."reported_id")
);
--> statement-breakpoint
CREATE TABLE "calls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"a_user_id" uuid NOT NULL,
	"b_user_id" uuid NOT NULL,
	"region" text NOT NULL,
	"mode" "call_mode" NOT NULL,
	"lang_a" text NOT NULL,
	"lang_b" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"connected_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"end_reason" "call_end_reason",
	"connect_ms" integer,
	"sampling_tier" text DEFAULT 'client' NOT NULL,
	"policy_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calls_distinct_users" CHECK ("calls"."a_user_id" <> "calls"."b_user_id"),
	CONSTRAINT "calls_connect_ms_nonnegative" CHECK ("calls"."connect_ms" is null or "calls"."connect_ms" >= 0),
	CONSTRAINT "calls_end_after_start" CHECK ("calls"."ended_at" is null or "calls"."ended_at" >= "calls"."started_at"),
	CONSTRAINT "calls_sampling_tier_allowed" CHECK ("calls"."sampling_tier" in ('none', 'client', 'server', 'elevated', 'report'))
);
--> statement-breakpoint
CREATE TABLE "friend_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"from_user_id" uuid NOT NULL,
	"to_user_id" uuid NOT NULL,
	"status" "friend_request_status" DEFAULT 'pending' NOT NULL,
	"message" text,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "friend_requests_not_self" CHECK ("friend_requests"."from_user_id" <> "friend_requests"."to_user_id"),
	CONSTRAINT "friend_requests_message_length" CHECK ("friend_requests"."message" is null or char_length("friend_requests"."message") <= 500)
);
--> statement-breakpoint
CREATE TABLE "friendships" (
	"user_low" uuid NOT NULL,
	"user_high" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "friendships_user_low_user_high_pk" PRIMARY KEY("user_low","user_high"),
	CONSTRAINT "friendships_canonical_order" CHECK ("friendships"."user_low" < "friendships"."user_high")
);
--> statement-breakpoint
CREATE TABLE "messages_dm" (
	"id" uuid PRIMARY KEY NOT NULL,
	"thread_key" text NOT NULL,
	"sender_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"body" text NOT NULL,
	"read_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	"removal_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_dm_not_self" CHECK ("messages_dm"."sender_id" <> "messages_dm"."recipient_id"),
	CONSTRAINT "messages_dm_body_length" CHECK (char_length("messages_dm"."body") between 1 and 2000),
	CONSTRAINT "messages_dm_removal_consistent" CHECK (("messages_dm"."removed_at" is null) = ("messages_dm"."removal_reason" is null))
);
--> statement-breakpoint
CREATE TABLE "coin_ledger" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"reason" "coin_reason" NOT NULL,
	"ref_type" text,
	"ref_id" text,
	"idempotency_key" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coin_ledger_delta_nonzero" CHECK ("coin_ledger"."delta" <> 0),
	CONSTRAINT "coin_ledger_idempotency_key_present" CHECK (length(btrim("coin_ledger"."idempotency_key")) > 0)
);
--> statement-breakpoint
CREATE TABLE "stripe_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"payload_sha256" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text,
	CONSTRAINT "stripe_events_payload_sha256_format" CHECK ("stripe_events"."payload_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"stripe_subscription_id" text NOT NULL,
	"plan" text NOT NULL,
	"status" "subscription_status" NOT NULL,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"key" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"rollout" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feature_flags_key_present" CHECK (length(btrim("feature_flags"."key")) > 0),
	CONSTRAINT "feature_flags_rollout_object" CHECK (jsonb_typeof("feature_flags"."rollout") = 'object')
);
--> statement-breakpoint
CREATE TABLE "market_policies" (
	"market" text PRIMARY KEY NOT NULL,
	"service_class" "service_class" DEFAULT 'blocked' NOT NULL,
	"required_age_tier" "age_tier" DEFAULT 't1_estimated' NOT NULL,
	"guest_minutes_per_day" integer DEFAULT 0 NOT NULL,
	"monetization_enabled" boolean DEFAULT false NOT NULL,
	"matching_enabled" boolean DEFAULT false NOT NULL,
	"residency" "residency" DEFAULT 'global' NOT NULL,
	"retention_days" integer DEFAULT 30 NOT NULL,
	"reporting_authority" text DEFAULT 'pending_legal' NOT NULL,
	"primary_languages" text[] DEFAULT '{}'::text[] NOT NULL,
	"moderator_coverage" boolean DEFAULT false NOT NULL,
	"legal_signoff_ref" text,
	"signer" text,
	"policy_version" integer DEFAULT 1 NOT NULL,
	"effective_at" timestamp with time zone DEFAULT now() NOT NULL,
	"changelog" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_policies_iso2" CHECK ("market_policies"."market" ~ '^[A-Z]{2}$'),
	CONSTRAINT "market_policies_guest_minutes" CHECK ("market_policies"."guest_minutes_per_day" >= 0),
	CONSTRAINT "market_policies_retention_positive" CHECK ("market_policies"."retention_days" > 0),
	CONSTRAINT "market_policies_version_positive" CHECK ("market_policies"."policy_version" > 0),
	CONSTRAINT "market_policies_languages_format" CHECK (cardinality("market_policies"."primary_languages") = 0 or array_to_string("market_policies"."primary_languages", ',') ~ '^[a-z]{2}(,[a-z]{2})*$'),
	CONSTRAINT "market_policies_reporting_authority_format" CHECK ("market_policies"."reporting_authority" ~ '^(ncmec|both|pending_legal|national:[A-Z]{2})$'),
	CONSTRAINT "market_policies_enabled_requires_signoff" CHECK ("market_policies"."service_class" = 'blocked' or ("market_policies"."legal_signoff_ref" is not null and length(btrim("market_policies"."legal_signoff_ref")) > 0 and "market_policies"."signer" is not null and length(btrim("market_policies"."signer")) > 0)),
	CONSTRAINT "market_policies_enabled_requires_moderation_coverage" CHECK ("market_policies"."service_class" = 'blocked' or "market_policies"."moderator_coverage"),
	CONSTRAINT "market_policies_enabled_requires_reporting_authority" CHECK ("market_policies"."service_class" = 'blocked' or "market_policies"."reporting_authority" in ('ncmec', 'both') or "market_policies"."reporting_authority" like 'national:%'),
	CONSTRAINT "market_policies_enabled_requires_age_assurance" CHECK ("market_policies"."service_class" = 'blocked' or "market_policies"."required_age_tier" <> 't0_declared'),
	CONSTRAINT "market_policies_blocked_cannot_match_or_monetize" CHECK ("market_policies"."service_class" <> 'blocked' or ("market_policies"."matching_enabled" = false and "market_policies"."monetization_enabled" = false)),
	CONSTRAINT "market_policies_limited_cannot_monetize" CHECK ("market_policies"."service_class" <> 'limited' or "market_policies"."monetization_enabled" = false)
);
--> statement-breakpoint
ALTER TABLE "age_verifications" ADD CONSTRAINT "age_verifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocker_id_users_id_fk" FOREIGN KEY ("blocker_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocked_id_users_id_fk" FOREIGN KEY ("blocked_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_scores" ADD CONSTRAINT "trust_scores_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ban_appeals" ADD CONSTRAINT "ban_appeals_ban_id_bans_id_fk" FOREIGN KEY ("ban_id") REFERENCES "public"."bans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ban_appeals" ADD CONSTRAINT "ban_appeals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ban_appeals" ADD CONSTRAINT "ban_appeals_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bans" ADD CONSTRAINT "bans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bans" ADD CONSTRAINT "bans_issued_by_id_users_id_fk" FOREIGN KEY ("issued_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_events" ADD CONSTRAINT "moderation_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reported_id_users_id_fk" FOREIGN KEY ("reported_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_moderator_id_users_id_fk" FOREIGN KEY ("moderator_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_a_user_id_users_id_fk" FOREIGN KEY ("a_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_b_user_id_users_id_fk" FOREIGN KEY ("b_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friend_requests" ADD CONSTRAINT "friend_requests_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friend_requests" ADD CONSTRAINT "friend_requests_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user_low_users_id_fk" FOREIGN KEY ("user_low") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user_high_users_id_fk" FOREIGN KEY ("user_high") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages_dm" ADD CONSTRAINT "messages_dm_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages_dm" ADD CONSTRAINT "messages_dm_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coin_ledger" ADD CONSTRAINT "coin_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coin_ledger" ADD CONSTRAINT "coin_ledger_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "age_verifications_provider_ref_unique" ON "age_verifications" USING btree ("provider","provider_ref");--> statement-breakpoint
CREATE INDEX "age_verifications_user_idx" ON "age_verifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "age_verifications_expiry_idx" ON "age_verifications" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "blocks_blocked_idx" ON "blocks" USING btree ("blocked_id");--> statement-breakpoint
CREATE INDEX "blocks_created_at_idx" ON "blocks" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_fingerprint_unique" ON "devices" USING btree ("fingerprint_hash");--> statement-breakpoint
CREATE INDEX "devices_user_idx" ON "devices" USING btree ("user_id","last_seen_at");--> statement-breakpoint
CREATE INDEX "devices_last_seen_idx" ON "devices" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "ip_reputation_high_risk_idx" ON "ip_reputation" USING btree ("score") WHERE "ip_reputation"."score" > 70;--> statement-breakpoint
CREATE INDEX "ip_reputation_expiry_idx" ON "ip_reputation" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "profiles_interests_idx" ON "profiles" USING gin ("interests");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_unique" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "sessions_expiry_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "trust_scores_band_idx" ON "trust_scores" USING btree ("band");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email") WHERE "users"."email" is not null;--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "users" USING btree ("status") WHERE "users"."status" <> 'active';--> statement-breakpoint
CREATE INDEX "users_guest_cleanup_idx" ON "users" USING btree ("is_anonymous","last_seen_at") WHERE "users"."is_anonymous" = true;--> statement-breakpoint
CREATE INDEX "users_created_at_idx" ON "users" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_target_idx" ON "audit_logs" USING btree ("target_type","target_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "ban_appeals_ban_unique" ON "ban_appeals" USING btree ("ban_id");--> statement-breakpoint
CREATE INDEX "ban_appeals_queue_idx" ON "ban_appeals" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "bans_user_idx" ON "bans" USING btree ("user_id","expires_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "bans_one_active_permanent_per_scope" ON "bans" USING btree ("user_id","scope") WHERE "bans"."revoked_at" is null and "bans"."expires_at" is null;--> statement-breakpoint
CREATE INDEX "bans_appeal_queue_idx" ON "bans" USING btree ("appeal_status") WHERE "bans"."appeal_status" = 'requested';--> statement-breakpoint
CREATE INDEX "moderation_events_user_idx" ON "moderation_events" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "moderation_events_call_idx" ON "moderation_events" USING btree ("call_id");--> statement-breakpoint
CREATE INDEX "moderation_events_label_idx" ON "moderation_events" USING btree ("label","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "moderation_events_action_idx" ON "moderation_events" USING btree ("action_taken") WHERE "moderation_events"."action_taken" <> 'none';--> statement-breakpoint
CREATE UNIQUE INDEX "reports_call_reporter_unique" ON "reports" USING btree ("call_id","reporter_id");--> statement-breakpoint
CREATE INDEX "reports_queue_idx" ON "reports" USING btree ("status","severity","created_at");--> statement-breakpoint
CREATE INDEX "reports_recidivism_idx" ON "reports" USING btree ("reported_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "reports_call_idx" ON "reports" USING btree ("call_id");--> statement-breakpoint
CREATE INDEX "calls_a_user_idx" ON "calls" USING btree ("a_user_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "calls_b_user_idx" ON "calls" USING btree ("b_user_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "calls_region_idx" ON "calls" USING btree ("region","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "calls_unended_idx" ON "calls" USING btree ("ended_at") WHERE "calls"."ended_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "friend_requests_pending_pair_unique" ON "friend_requests" USING btree (least("from_user_id", "to_user_id"),greatest("from_user_id", "to_user_id")) WHERE "friend_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "friend_requests_inbox_idx" ON "friend_requests" USING btree ("to_user_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "friendships_high_idx" ON "friendships" USING btree ("user_high");--> statement-breakpoint
CREATE INDEX "messages_dm_thread_idx" ON "messages_dm" USING btree ("thread_key","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "messages_dm_unread_idx" ON "messages_dm" USING btree ("recipient_id","read_at") WHERE "messages_dm"."read_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "coin_ledger_idempotency_unique" ON "coin_ledger" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "coin_ledger_user_idx" ON "coin_ledger" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "stripe_events_unprocessed_idx" ON "stripe_events" USING btree ("received_at") WHERE "stripe_events"."processed_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_stripe_id_unique" ON "subscriptions" USING btree ("stripe_subscription_id");--> statement-breakpoint
CREATE INDEX "subscriptions_user_idx" ON "subscriptions" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "subscriptions_period_end_idx" ON "subscriptions" USING btree ("current_period_end");