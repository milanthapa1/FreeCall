# Data model

Postgres 16, Drizzle ORM, drizzle-kit migrations. Snake_case, UUID v7 primary keys generated in
the application, `created_at`/`updated_at` (`timestamptz`, UTC) on every table, `updated_at`
maintained by a single trigger function `set_updated_at()`.

Design rules:

- IDs are UUID v7 (`packages/db/src/id.ts`) — time-sortable, index-friendly, no extension needed.
- No soft deletes except `users.deleted_at` (account deletion tombstone). Everything else is
  either hard-deleted by a retention job or retained under legal hold.
- Money, bans and age state are never soft-deleted; they are corrected with compensating rows.
- All FKs are `ON DELETE RESTRICT` by default. Cascades are explicit and reviewed, because a
  cascade that deletes evidence is a compliance incident.
- Enum-like fields are Postgres enums only when the value set is stable and reviewed; otherwise
  `text` + a `CHECK` constraint so adding a reason code does not require a type migration.
- JSONB is for provider payloads and signal arrays, never for values we filter or join on.

## Core identity and safety

### `users`
`id`, `email` (nullable, unique partial where not null), `email_verified_at`, `is_anonymous`,
`role` (`user|moderator|senior_reviewer|legal|auditor|admin`), `status`
(`active|suspended|locked|deleted`), `age_tier` (`t0_declared|t1_estimated|t2_verified|t3_locked`),
`market`, `trust_score` (denormalized, see `trust_scores`), `coin_balance` (cache),
`last_seen_at`, `deleted_at`.

Indexes: `unique (email) where email is not null`; `(status) where status <> 'active'`;
`(is_anonymous, last_seen_at)` for guest cleanup; `(created_at)` for cohort analytics.

### `sessions` (Better Auth)
`id`, `user_id`, `token_hash`, `audience` (`user|admin`), `ip_hash`, `device_id`, `expires_at`,
`idle_expires_at`, `revoked_at`, `created_at`, `updated_at`.
Indexes: `unique (token_hash)`; `(user_id, created_at desc)`; `(expires_at)` for the sweeper.
Admin sessions require `audience='admin'` and MFA; the middleware checks the audience, not just
`role`.

### `profiles`
`user_id` PK/FK, `display_name`, `bio`, `avatar_public_id`, `interests` (text[]), `gender`
(private, matching only), `looking_for`, `updated_at`.
Indexes: `unique (user_id)`; GIN on `interests` (Phase 6); no public search index on `bio` —
profile discovery is not a feature.

### `age_verifications`
`id`, `user_id`, `provider` (`yoti|persona|veriff|manual`), `provider_ref`, `status`
(`pending|passed|failed|expired|revoked`), `tier` (awarded tier), `age_band`, `decision_hash`,
`verified_at`, `expires_at`, `created_at`, `updated_at`.
Indexes: `unique (provider, provider_ref)`; `(user_id, created_at desc)`;
`(status, expires_at)` for re-verification. Raw documents are **never** stored.

### `devices`
`id`, `user_id`, `fingerprint_hash`, `ua_family`, `first_seen_at`, `last_seen_at`,
`risk_flags` (text[]), `revoked_at`.
Indexes: `unique (fingerprint_hash)`; `(user_id, last_seen_at desc)`; `(last_seen_at)` for TTL.
Purpose: risk signal and ban evasion only; 90-day retention after last seen.

### `ip_reputation`
`ip_hash` PK (salted SHA-256, never the raw IP), `asn`, `country`, `score` (0–100),
`signals` jsonb, `first_seen_at`, `last_seen_at`, `expires_at`.
Indexes: `(score)` partial `where score > 70`; `(expires_at)`. Raw IPs exist only in Cloudflare
and in short-lived rate-limit keys (Redis, ≤24h), never in Postgres.

### `blocks`
`blocker_id`, `blocked_id`, `reason`, `source` (`user|moderation`), `created_at`.
PK `(blocker_id, blocked_id)`; index `(blocked_id)` for symmetric checks; `(created_at)`.
Materialized into Redis exclusion sets by the worker (ADR-0003).

### `trust_scores`
`user_id` PK, `score` (0–100), `band` (`low|normal|high`), `components` jsonb (report accuracy,
age tier, account age, call completion, moderation history), `computed_at`.
Index: `(band)` for matching analytics. Recomputed by the worker every 15 minutes for active
users and on every enforcement event.

### `moderation_events`
`id`, `user_id` (subject), `call_id`, `source` (`visual|text|report|heuristic|human`),
`label`, `score` numeric(5,4), `model`, `model_version`, `policy_version`, `action_taken`,
`frame_ref` (evidence key or null), `created_at`.
Indexes: `(user_id, created_at desc)`; `(call_id)`; `(label, created_at desc)` for tuning;
`(action_taken) where action_taken <> 'none'`. Partitioned monthly by `created_at`.
This table is append-only; a correction is a new row with `source='human'`.

### `bans`
`id`, `user_id`, `scope` (`call|dm|upload|platform`), `reason_code`, `note`, `issued_by`
(`system|moderator_id`), `evidence_case_id`, `starts_at`, `expires_at` (null = permanent),
`revoked_at`, `appeal_status` (`none|requested|upheld|overturned`), `created_at`, `updated_at`.
Indexes: `(user_id, expires_at desc)`; `unique (user_id, scope) where revoked_at is null and
expires_at is null` (one active permanent ban per scope); `(appeal_status) where appeal_status =
'requested'`. The hot check is a Redis cache (`ban:{user_id}`) refreshed on write and TTL 60s;
Postgres remains the source of truth and is consulted on every ban change and every appeal.

### `ban_appeals`
`id`, `ban_id` (unique), `user_id`, `statement` (≤2000 chars), `status`
(`submitted|in_review|upheld|overturned`), `reviewer_id`, `decision_note`, `decided_at`,
`created_at`, `updated_at`.
Indexes: `unique (ban_id)`; `(status, created_at)` for the appeal queue.

## Calls and messaging

### `calls`
`id` (uuid v7, also the idempotency key across services), `a_user_id`, `b_user_id`, `region`,
`mode` (`solo|solo_couple|couple`), `lang_a`, `lang_b`, `started_at`, `connected_at`,
`ended_at`, `end_reason` (`skip|stop|disconnect|setup_timeout|enforcement|error|partner_left`),
`connect_ms`, `sampling_tier`, `policy_version`.
Indexes: `(a_user_id, started_at desc)`; `(b_user_id, started_at desc)`; `(region, started_at
desc)` for shift stats; `(ended_at) where ended_at is null` for the reconciler.
Partitioned monthly by `started_at`. Written asynchronously by the worker; `id` makes retries
idempotent. **No per-match DB write.**

### `reports`
`id`, `call_id`, `reporter_id`, `reported_id`, `reason` (`nudity|minor|violence|harassment|spam|
scam|ncii|other`), `note` (≤500), `status` (`open|evidence_pending|in_review|actioned|dismissed|
escalated`), `severity` (`low|medium|high|critical`), `evidence_manifest_key`,
`evidence_sha256`, `moderator_id`, `resolved_at`, `created_at`, `updated_at`.
Indexes: `unique (call_id, reporter_id)` (one report per person per call; re-reports are
comments on the same case); `(status, severity, created_at)` for the console queue;
`(reported_id, created_at desc)` for recidivism. Partitioned monthly by `created_at`.

### `messages_dm`
`id`, `thread_key` (deterministic sorted pair hash), `sender_id`, `recipient_id`, `body`
(≤2000, post-moderation), `created_at`, `read_at`, `removed_at`, `removal_reason`.
Indexes: `(thread_key, created_at desc)`; `(recipient_id, read_at) where read_at is null`.
In-call chat is **not persisted** — it lives in memory and is captured into evidence only on a
report (data minimization). This is deliberate, not an omission.

### `friendships`, `friend_requests`
`friendships(user_low, user_high)` PK with `CHECK (user_low < user_high)`, `created_at`.
`friend_requests(id, from_user, to_user, status, message, created_at, responded_at)` with
`unique (from_user, to_user) where status = 'pending'`. Indexes on `to_user, status` for the
inbox.

## Money and growth (Phase 5)

### `coin_ledger` — append-only
`id`, `user_id`, `delta` int, `reason` (`purchase|daily_grant|spend_priority|spend_filter|
spend_hd|refund|chargeback|admin_adjust`), `ref_type`, `ref_id`, `idempotency_key`,
`created_at`, `created_by`.
`unique (idempotency_key)`; `(user_id, created_at desc)`. Partitioned monthly; app role has no
`UPDATE`/`DELETE` grant. Balance cache on `users` is reconciled nightly.

### `subscriptions`
`id`, `user_id`, `stripe_customer_id`, `stripe_subscription_id` (unique), `plan`, `status`,
`current_period_end`, `cancel_at_period_end`, `created_at`, `updated_at`.
Index `(user_id, status)`; `(current_period_end)` for expiry jobs.

### `stripe_events`
`event_id` PK, `type`, `payload_sha256`, `processed_at`, `error`. Dedupe + replay diagnostics.

## Operations

### `audit_logs`
`id`, `actor_id` (nullable for system), `actor_role`, `action`, `target_type`, `target_id`,
`before` jsonb (redacted), `after` jsonb (redacted), `reason_code`, `ip_hash`, `request_id`,
`created_at`. Indexes: `(target_type, target_id, created_at desc)`; `(actor_id, created_at
desc)`; `(action, created_at desc)`. Partitioned monthly, retained 24 months (see `privacy.md`).

### `feature_flags`, `market_policies`
`feature_flags(key PK, enabled, rollout jsonb, updated_by, updated_at)`.
`market_policies(market PK, service_class, required_age_tier, guest_minutes_per_day,
monetization_enabled, matching_enabled, residency, retention_days, reporting_authority,
primary_languages text[], moderator_coverage bool, legal_signoff_ref, policy_version,
effective_at, changelog, updated_at)`.
Rows exist for every ISO-3166-1 alpha-2 code; a missing row is treated as `blocked`. Realtime and
web cache the resolved row for 30s; writes are audited and versioned (ADR-0018).

## Hot-path index review

| Path | Query | Index |
|---|---|---|
| Enqueue ban check | `bans` by user, active | Redis `ban:{user}` + `(user_id, expires_at desc)` fallback |
| Match exclusion | block list for a user | Redis `ex:{shard}:{sid}`, hydrated from `(blocker_id)` + `(blocked_id)` |
| Report queue | open cases by severity age | `(status, severity, created_at)` |
| Recidivism | reports against a user | `(reported_id, created_at desc)` |
| Case timeline | events for a call | `(call_id)` on `moderation_events` |
| DM inbox | unread per recipient | `(recipient_id, read_at) where read_at is null` |
| Ledger balance | sum per user | `(user_id, created_at desc)` + cached balance |
| Shift stats | calls per region per hour | `(region, started_at desc)` |
| Ban appeal SLA | requested appeals | `(status, created_at)` |

## Migration notes

1. **Expand/contract only.** Add nullable → deploy writers that fill both → backfill in batches
   of 5,000 with a sleep → add constraint/`NOT NULL` (validated) → drop old. Never rename in one
   step.
2. **Indexes in production** are created with `CREATE INDEX CONCURRENTLY` outside a transaction,
   in a hand-written migration file with a comment explaining why drizzle-kit cannot emit it.
3. **Enums** change by creating `foo_v2`, altering the column with `USING`, then dropping the old
   type in a later release. Reason codes are `text + CHECK` to avoid this.
4. **Partitions** are created by `ensure_partitions(months_ahead => 3)` run daily by the worker;
   a default partition exists so an outage of the job cannot reject writes.
5. **pgbouncer**: transaction pooling requires `prepare: false` (postgres.js) and forbids session
   state. `LISTEN/NOTIFY`, advisory locks and `SET` are banned in app code; CI greps for them.
6. **Backfills** run from the worker, are resumable by `id > last_id` keyset pagination, and are
   throttled by a Redis token bucket so a backfill cannot starve the primary.
7. **Rollback** for every migration is written in the PR description. Destructive ones require a
   second reviewer and a restore-point confirmation.
8. **Retention** is implemented as SQL jobs + R2 lifecycle rules, never as ad-hoc scripts; each
   job logs counts and is tested against fixtures in CI.
