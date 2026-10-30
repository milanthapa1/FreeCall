# Phased plan and acceptance criteria

Each phase ends with: tests run, a written summary of what changed, known gaps, and a
proposed next step. A phase is not "done" because code merged — it is done when the
acceptance criteria below are demonstrated in CI or staging, with evidence linked.

Global definition of done for every phase:

- `npm run typecheck`, `npm run lint`, `npm test` green on a clean checkout.
- No new `any`, no `@ts-ignore`, no unvalidated external input.
- Every new table has a migration, an index review, and a retention classification.
- Every new external call has a timeout, a retry policy, and a circuit breaker or a
  written reason why not.
- Every new user-visible string exists in `packages/i18n` (en first), with no hardcoded copy.
- Every new automated enforcement path writes an `audit_logs` row and a metric.
- Docs updated in the same commit as behaviour changes.

---

## Phase 0 — Foundation (1 sprint)

**Scope**

- Turborepo + npm workspaces (`package-lock.json` committed, `npm ci` in CI); strict TS base
  config; ESLint/Prettier; Vitest; Playwright.
- `packages/config`: per-app zod env schemas, fail-fast at boot, `.env.example`, secret
  naming convention, boot assertion that no server secret is prefixed `NEXT_PUBLIC_`.
- `packages/protocol`: versioned zod event schemas + generated types; contract tests.
- `packages/db`: full Drizzle schema for MVP tables, `drizzle-kit` migrations, seed script,
  uuid v7 helper, `updated_at` trigger.
- `packages/observability`: OTel SDK init, Sentry init, structured logger with PII redaction,
  metric naming convention.
- `infra/docker`: Postgres 16, Redis 7 (single node + cluster mode profile), LiveKit,
  mock moderation provider, mock age-assurance provider, MailHog, MinIO as R2 stand-in.
- CI: install, typecheck, lint, unit, contract, migration-from-scratch, build, dependency
  and secret scanning. Branch protection on `main`.
- `docs/dependencies.md`, `SECURITY.md`, `CONTRIBUTING.md`.

**Acceptance criteria**

1. `npm ci && npm run db:migrate && npm test` succeeds from a clean clone on Linux and Windows.
2. `npm run dev` starts web, realtime, worker and all docker services; `/api/health` reports
   dependency status for postgres, redis, livekit, storage.
3. Removing `DATABASE_URL` or setting `LIVEKIT_API_SECRET` to a 3-character string makes
   the process exit non-zero at boot with a precise message — covered by a unit test.
4. Migrations apply from zero and roll forward on a database seeded with the previous
   schema version (expand/contract discipline documented in `data-model.md`).
5. Protocol package rejects unknown fields, oversized payloads and wrong version — 100% of
   event variants covered by contract tests (table-driven, snapshot of the schema JSON).
6. CI runs in under 12 minutes on a cold cache and blocks merge on any failure.
7. `docker compose up` alone is enough for a new engineer to run the full product locally.

**Exit gate:** a second engineer can boot the repo from the README without help.

---

## Phase 1 — Age gate, guest identity, landing, permissions (1.5 sprints)

**Scope**

- Landing page: localized, SEO (metadata, hreflang, OG, sitemap, robots), static-first,
  no client JS in the critical path beyond hydration of the start control.
- Age gate: DOB or 18+ attestation per market, server-verified age state, risk-tiered
  assurance abstraction (`AgeAssuranceProvider`), guest cap policy, re-prompt rules.
- Guest sessions via Better Auth anonymous plugin, plus Google/Apple/magic link wiring
  behind a flag (accounts become user-facing in Phase 4).
- Turnstile on guest start; per-IP and per-device rate limits; device fingerprint stored
  as a risk signal with documented purpose limitation.
- Camera/mic permission flow: pre-permission explainer, `getUserMedia` with device
  enumeration, denied/no-device/unsupported-browser states, audio-only fallback entry point
  (voice-only is Phase 6, but the fallback screen exists).
- Rules overlay on first use, persisted acknowledgement keyed to policy version.
- i18n scaffold (en, es, pt-BR, hi, ar with RTL), locale negotiation, currency/timezone-safe
  formatting.
- Consent banner (analytics/marketing categories), consent-gated PostHog init.

**Acceptance criteria**

1. No route that can reach `enqueue` is reachable without a server-side age state
   `>= required_tier(market)`; e2e test attempts direct API enqueue with a forged client flag
   and receives `403 age_required`.
2. A guest that self-declares is capped: no DMs, no uploads, no profile, lower trust band,
   and a maximum of 30 call-minutes per day before re-assurance is required. Enforced
   server-side and unit-tested at the boundary.
3. Landing page LCP p75 < 2.0s on a throttled 4G profile (Lighthouse CI, budget enforced in CI),
   CLS < 0.05, JS transferred for the landing route < 120KB gzip.
4. Lighthouse accessibility score >= 95 and axe reports zero serious/critical issues on
   landing, age gate, permission flow and rules overlay.
5. Permission-denied, no-camera, and insecure-context states are all reachable in Playwright
   with fake media devices and produce actionable copy plus a support link.
6. Guest start is rate limited: 60 starts/IP/hour and 5 starts/device/hour in staging load
   test, with `429` and `Retry-After`; Turnstile failure path returns a friendly retry.
7. Analytics events carry no raw IP, no user agent string, no free text.

**Exit gate:** legal review of age-gate copy and the guest-cap policy signed off.

---

## Phase 2 — Matchmaking, realtime video, core call UX (3 sprints)

**Scope**

- Realtime service: uWebSockets.js, JWT-authenticated sockets, versioned protocol, per-event
  token-bucket rate limits, heartbeat/TTL presence, graceful drain on SIGTERM.
- Matching: Redis Cluster sharded queues, Lua atomic pop, block/cooldown exclusion, trust-band
  preference, mutual country preference, 5s/10s widening, priority requeue on failed setup.
- LiveKit room creation, short-lived participant tokens, 8s connect deadline, TURN fallback,
  region selection, sticky routing.
- Web call surface: split desktop / full-bleed mobile, draggable self-view, next/skip
  (button, swipe, `S`/`Esc`), stop, disconnect detection, socket auto-reconnect without
  partner reconnection, network quality indicator, camera switch, mute/camera-off warnings.
- Chat: text alongside video, typing indicator, emoji picker, per-message translation toggle
  (provider abstraction with a mock for local dev), 50-message rolling buffer for reports.
- Deterministic matchmaking simulator + k6 scenarios; chaos test for Redis failover.

**Acceptance criteria**

1. Time-to-match p95 < 2.0s at 50k queued users in a single region in staging; p99 < 5.0s.
   Measured by the simulator with a fixed seed and reproducible histogram output.
2. Matchmaking throughput sustains 50,000 matches/second for 5 minutes without error rate
   > 0.1% or Redis CPU > 70%. (Capacity math in `architecture.md`: steady state is ~2.1k/s,
   projected peak ~6.3k/s, so 50k/s is ~8x peak — deliberately over-provisioned as a
   burst/failover target.)
3. Mutually exclusive country preferences never match — 100k simulated attempts, zero
   violations, assertion in the simulator.
4. Blocked pairs and partners seen within the last 30 minutes never match — same harness,
   zero violations, including across a Redis failover.
5. Connect success >= 97% of matched pairs establishing bidirectional media within 8s in a
   500-pair staging soak; failures requeue both participants with priority and are counted.
6. Killing one realtime pod drains it: zero dropped sessions among healthy clients, all
   clients reconnected to a new pod within 5s, in-flight calls unaffected (media is SFU-side).
7. Redis primary failover: enqueue continues within 10s, no duplicate pairing, no lost
   `matched` event for already-paired users (see `runbooks/redis-failover.md`).
8. Chat p99 delivery < 250ms same-region; typing indicator rate-limited and dropped silently
   above 1/s per participant.
9. e2e happy path (two browser contexts with fake media) matches, chats, skips, and re-matches.
10. All protocol events validated by shared zod schemas; fuzzing unknown fields yields
    `protocol_error` without closing the socket for a single bad frame.

**Exit gate:** load test evidence attached to the phase summary; SLO dashboards live.

---

## Phase 3 — Safety and moderation MVP (3 sprints) — completes MVP

**Scope**

- Frame sampling (server-side egress for elevated-risk rooms, client-side advisory frames for
  low-risk rooms), visual classifier adapters (Hive + Sightengine), normalized label taxonomy,
  per-label thresholds, shadow-flag escalation of sampling rate.
- Text moderation: normalization (leetspeak, homoglyphs, spacing), link/contact blocking,
  duplicate-spam detection across partners, OpenAI moderation + custom rules.
- CSAM hash matching and the minors-risk path: immediate disconnect, account lock, evidence
  preservation in a restricted R2 bucket with legal hold, two-person break-glass, NCMEC/ESP
  reporting workflow, law-enforcement request handling.
- Report flow: captures partner frame + last 50 messages + call metadata, uploads to private
  storage via presigned POST, creates a case, notifies the queue.
- Block list, persistent, applied before matchmaking and after reports.
- Auto-ban engine: weighted distinct reporters in a window, temporary → permanent escalation,
  appeal form, appeal state machine, moderator decisions with reason codes.
- Moderator console at `/admin`: RBAC (moderator, senior, legal, read-only auditor), live case
  queue, screenshot and chat with blur-by-default and click-to-reveal, one-click ban/dismiss
  with reason codes, audit log, shift stats, wellness controls (break timer, blurred media,
  no autoplay of video).
- Weekly safety report job: FP rate, time-to-action, ban recidivism, appeal overturn rate.
- Runbooks: CSAM escalation, moderator exposure incident, mass-report brigading.

**Acceptance criteria**

1. A report produces a case with an immutable evidence bundle within 10s p95; the bundle
   contains exactly one partner frame, the last 50 messages, call metadata, and a hash
   manifest. Evidence is unreachable from any client-reachable URL (verified by attempting
   unsigned and expired-signature access).
2. High-confidence minors-risk or CSAM hash hit: participant disconnected within 5s of the
   classification, account locked, evidence written to the restricted bucket with legal hold,
   case created with `severity=critical`, and the on-call escalation paged. Verified with the
   mock CSAM provider in e2e; no real CSAM data is ever used in tests.
3. Restricted-bucket access requires break-glass with two approvers; the access itself is
   audited; moderators see hash-match metadata only. Unit + integration test of the policy.
4. Medium-confidence violation shadow-flags the participant: sampling interval drops to 2s,
   matchmaking continues, a case is queued, no user-visible change (verified by metric, not UI).
5. Auto-ban: 3 distinct trusted reporters within 24h yields a 24h ban; a second ban within 30d
   yields a permanent ban; each transition is idempotent and replay-tested. Reporter trust
   weighting changes the outcome in a seeded scenario table.
6. Ban evasion: a banned device fingerprint opening a new guest session is blocked at enqueue
   in >= 95% of seeded cases (measured against the device/reputation mock corpus).
7. Moderator console: RBAC enforced server-side on every action; a moderator cannot see the
   legal bucket; every action writes an `audit_logs` row with actor, before/after, reason code.
8. Text moderation blocks links, obfuscated links, and contact-handle patterns in >= 98% of a
   500-case labelled corpus, with FP rate on benign chat <= 2%.
9. Weekly report generates from fixtures and is attached to a scheduled job in staging.
10. Wellness: media blurred by default, reveal is per-item and time-boxed, break reminders after
    45 minutes of case activity, and an exposure incident runbook exists and is exercised once.

**Exit gate:** trust-and-safety lead signs off the CSAM runbook; legal signs off retention;
external tabletop exercise of the escalation path completed.

---

## Phase 4 — Accounts and social (2.5 sprints)

Profile, avatar (Cloudinary signed upload + moderation add-on), bio, interests, friends,
follow/followers, friend requests, text-only DMs with rate limits and the same moderation
pipeline, post-chat "add friend" prompt, account settings, data export and deletion.

**Acceptance criteria**

1. Upgrading a guest to an account preserves history and call reputation, and revokes the
   guest capability set atomically (no window where both exist).
2. DM send is rate limited per pair and per user; blocked users cannot DM; every DM passes
   text moderation before persistence and is rejected, not stored, on high-confidence hits.
3. Account deletion removes or irreversibly pseudonymizes all personal data within 30 days,
   except evidence under legal hold and financial records, each listed explicitly; a dry-run
   report enumerates what will be kept and why.
4. Data export produces a machine-readable bundle within 24h via an async job with a signed,
   expiring download.
5. Avatars are moderated before first display; rejected uploads never appear to any other user.

---

## Phase 5 — Monetization, ads, PWA (2.5 sprints)

Stripe subscriptions and coin packs, append-only ledger with idempotency keys, daily free
coins, priority matching, legally appropriate filters, ad-free, HD (720p opt-in), ad slot
abstraction with consent gating and frequency caps, PWA install with offline shell.

**Acceptance criteria**

1. Webhook handlers are idempotent: replaying the last 30 days of Stripe events produces zero
   duplicate ledger rows; a property test asserts balance = sum(deltas) after arbitrary
   interleavings and replays.
2. Ledger is append-only at the database level (no UPDATE/DELETE grant to the app role);
   corrections are compensating entries with a reason and an actor.
3. Coin spend is atomic under concurrency: 200 parallel spends on a 100-coin balance yield
   exactly 100 successes.
4. HD toggle only affects a user's own publish quality; 720p is denied server-side when the
   subscription is inactive, regardless of client state.
5. Ad slots render nothing without consent for the relevant category; frequency caps are
   enforced server-side and verified by test.
6. PWA installs on Android and iOS Safari, serves an offline shell, and never caches media
   credentials or message content.

---

## Phase 6 — v2 (3 sprints)

Interest-based matching, voice-only mode, regional launch toggles with per-market policy
packs, ML-ranked matching by predicted conversation length (offline-trained, online-shadowed
first), localized moderator tooling and reason codes.

**Acceptance criteria**

1. Interest matching is a soft preference with a hard timeout so it can never increase p95 TTM
   beyond the 2s SLO; proven by A/B-shadow run.
2. Ranking model ships behind a flag, shadow mode first, with a documented evaluation harness
   and a rollback that requires no deploy.
3. Voice-only mode reuses the same safety pipeline and reports; frame sampling is replaced by
   audio classification with parity tests on the labelled corpus.
4. Regional toggles can disable matching or monetization per market without a deploy, and the
   change takes effect within 60s; policy packs are versioned and audited.

---

## Sequencing risks

- **Age assurance vendor onboarding is on the critical path** for Phase 1 exit. Start
  commercial and technical onboarding in week 1 of Phase 0.
- **LiveKit egress cost** for server-side sampling at 1M CCU is not viable at full coverage;
  ADR-0008 defines the tiered model. Revisit after Phase 3 with real violation rates.
- **Moderator staffing** must exist before Phase 3 exits; the console without humans is
  queue growth, not safety.
- **50k matches/s** is a burst target, not steady state (see `architecture.md`). If the
  business needs 1M CCU at 1-minute average calls, the design changes materially: ask before
  Phase 2 sizing.
