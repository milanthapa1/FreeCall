# Architecture

Status: proposed, Phase 0. Supersedes nothing. Decisions referenced as `ADR-00xx`.

## 1. Shape of the system

```
                        ┌──────────────────────────── Cloudflare ────────────────────────────┐
                        │ WAF · bot management · Turnstile · geo/DNS · R2 (evidence)         │
                        └───────────────┬───────────────────────────────┬────────────────────┘
                                        │                               │
                     ┌──────────────────▼─────────────┐        ┌────────▼─────────────┐
                     │  apps/web (Next.js 15, Vercel) │        │ LiveKit SFU cluster   │
                     │  RSC · Server Actions · /admin │        │ (per-region, TURN)    │
                     └───┬──────────┬──────────┬──────┘        └───────┬──────────────┘
                         │          │          │                       │ webhooks (room/participant)
             ┌───────────▼──┐  ┌────▼─────┐  ┌─▼──────────────┐        │
             │ Neon Postgres│  │ Redis    │  │ Cloudinary     │        │
             │ (Drizzle)    │  │ Cluster  │  │ (avatars)      │        │
             └───────┬──────┘  └────┬─────┘  └────────────────┘        │
                     │              │                                  │
                     │        ┌─────▼──────────────────────────────┐   │
                     │        │ apps/realtime (uWebSockets.js)     │◄──┘
                     │        │ queues · matching · signaling      │
                     │        └─────┬──────────────────────────────┘
                     │              │ matched / skip / report events
             ┌───────▼──────────────▼───────────┐
             │ apps/worker (Node)                │
             │ moderation · egress · bans · mail │
             └───────┬───────────────┬──────────┘
                     │               │
        ┌────────────▼────┐   ┌──────▼──────────────────────────┐
        │ Moderation APIs │   │ Age assurance providers         │
        │ Hive/Sightengine│   │ Yoti · Persona · Veriff · CSAM  │
        │ OpenAI + rules  │   │ hash matching (ISPP/PhotoDNA)   │
        └─────────────────┘   └─────────────────────────────────┘
```

Media never traverses `apps/web`. Signaling and matching live in `apps/realtime`; anything
that can block on a vendor call (moderation, egress, bans, email) lives in `apps/worker` so a
slow classifier can never add latency to a match.

## 2. Monorepo layout

```
.
├─ apps/
│  ├─ web/                     Next.js 15. App Router. Route groups:
│  │  ├─ (marketing)/          landing, rules, age gate, legal
│  │  ├─ (app)/                call surface, chat, reports, settings
│  │  └─ (admin)/admin/        moderator console (RBAC, server-enforced)
│  ├─ realtime/                uWebSockets.js service: auth, enqueue, match, signal, drain
│  └─ worker/                  BullMQ consumers: frames, text, evidence, bans, email, reports
├─ packages/
│  ├─ protocol/                zod event schemas (versioned), shared types, limits, contract tests
│  ├─ db/                      Drizzle schema, migrations, query helpers, seed, uuid v7
│  ├─ core/                    domain logic: age gate, matching policy, trust, bans, ledger, cases
│  ├─ moderation/              label taxonomy, thresholds, normalizers, provider adapters
│  ├─ providers/               age assurance, livekit, storage, cloudinary, stripe, translation
│  ├─ auth/                    Better Auth config + session helpers shared by web/worker
│  ├─ config/                  zod env schemas per runtime, secret-loading rules
│  ├─ ui/                      design tokens, shadcn primitives, call-surface components
│  ├─ i18n/                    next-intl messages, locale registry, RTL helpers
│  ├─ observability/           OTel, Sentry, logger with redaction, metric helpers
│  └─ testing/                 fake media, fake clock, provider fakes, property-test generators
├─ infra/
│  ├─ terraform/{modules,envs/staging,envs/prod}
│  ├─ docker/docker-compose.yml + init scripts + mock providers
│  └─ k6/                      matchmaking, signaling, api scenarios
├─ docs/                       this pack, ADRs, runbooks
└─ .github/workflows/          ci, e2e, load, security, deploy
```

Tooling: **npm workspaces** (lockfile committed, `npm ci` in CI) with Turborepo for task
graph and remote caching. Package scope is `@freecall/*` as a temporary working scope; a
single codemod renames it when the brand is fixed (ADR-0001).

## 3. Runtime responsibilities

| Component | Owns | Must never do |
|---|---|---|
| `web` | Auth UI, age gate, session issuance, report submission, admin console, Stripe webhooks, presigned uploads | Touch Redis queue internals, hold LiveKit API secret in the browser bundle |
| `realtime` | Socket auth, presence, enqueue/dequeue, matching, call lifecycle, typed events, drain | Call moderation vendors inline, write evidence, send email |
| `worker` | Frame/text classification, evidence assembly, ban engine, appeals emails, weekly reports, egress control | Serve user traffic, hold a per-request 8s budget |
| `protocol` | The only definition of wire events | Import app code (keeps it dependency-light for clients) |

## 4. Critical flows

**Start → matched**

1. `web` verifies session, age state `>= required_tier(market)`, guest caps, Turnstile, and
   issues a 60s JWT (`sub`, `sid`, `age_tier`, `trust_band`, `region`, `jti`, `v`).
2. Client opens `wss://rt-{region}.…/v1`, sends `hello` with the JWT.
3. Realtime validates JWT (JWKS, no DB round-trip), applies per-socket event budget, writes
   presence `presence:{sid}` with TTL, returns `hello_ok` + `server_time` + `limits`.
4. `enqueue` carries preferences (country, mode, language, own gender). Realtime derives the
   queue key server-side from authoritative session data; client-supplied values are
   preferences only and are clamped (ADR-0006).
5. Lua `pop_pair` runs on the queue shard; on success both sockets get `matched` with a LiveKit
   room name and a 60s participant token, plus `call_id`, `partner_summary` (no PII), and
   `connect_deadline_ms`.
6. Both clients join the LiveKit room. Realtime receives `joined` from each. If both `joined`
   within 8s, the call is `active`. Otherwise both are requeued with priority and the call is
   closed `setup_timeout`.
7. Media flows client↔SFU only. Signaling continues over the socket for chat, typing, skip.

**Skip / stop / disconnect**

`skip` closes the call with `end_reason=skip`, removes the pair cooldown entry, requeues the
skipper with priority 2 for 10s, and either requeues or releases the partner per their
`auto_next` flag. Socket loss without `stop` starts a 10s reconnect grace; media may survive
briefly, but the partner is never silently swapped — a reconnected user resumes the same
`call_id` or gets `call_ended`.

**Report**

Client sends `report` with reason + last 50 messages (client buffer, capped 16KB) and a
partner frame captured from the receiving `<video>` at 480p JPEG q0.7. Web presigns two R2
uploads after validating session membership in the `call`. Worker assembles the bundle,
hashes it, writes the case, and enqueues auto-ban evaluation. Evidence writes are idempotent
on `report_id`.

**Enforcement**

Classifier → `moderation_events` → policy engine in `core` → action (disconnect / shadow /
ban / lock) → `audit_logs` + OTel span + moderator queue. Every action carries
`model`, `model_version`, `score`, `threshold`, `policy_version`.

## 5. Capacity model (1M concurrent, sanity-checked)

Assumptions to confirm with the business (see open questions):

- 1M concurrent participants ⇒ 500k concurrent calls.
- Mean call length 240s ⇒ 1M/240 ≈ 4,167 participant arrivals/s ⇒ **≈2,083 matches/s steady**.
- Peak factor 3 ⇒ **≈6,250 matches/s**.

| Resource | Steady | Peak | Design point |
|---|---|---|---|
| Matches/s | 2.1k | 6.3k | **50k/s burst target** (≈8x peak) for failover absorption and regional evacuation |
| Signaling sockets | 1.0M | 1.3M | 100k sockets/pod at ≤40% CPU → 13 pods/region N+2 |
| Redis entries in queues | ≤1.0M | 1.3M | ~200MB cluster-wide at ~160B/entry incl. overhead |
| Concurrent LiveKit rooms | 500k | 650k | 2 participants, 480p ≈600kbps → **~600Gbps aggregate egress**, ~60Gbps/region |
| Client frame uploads | 250k/s @4s | 325k/s | ~10GB/s ingress worst case; why low-risk sampling is tiered (ADR-0008) |

Consequences: 50k matches/s cannot be served by one Lua-scripted queue; the matcher is
sharded per region with `{region}` hash tags so every key a single match touches is
slot-local, and exclusions (blocks, cooldowns) are materialized into the queue shard's own
Redis set with TTLs so the hot path never crosses shards (ADR-0003).

## 6. Deployment topology

- **web** on Vercel, multi-region functions, Neon in the primary region with pgbouncer.
  Server Actions and route handlers are the only writers; no direct DB access from the client.
- **realtime** on Fly.io: one app per region (`iad`, `sfo`, `lhr`, `fra`, `bom`, `sin`, `syd`,
  `gru`, `jnb`, `nrt`), 6PN internal, anycast TCP, sticky routing by consistent hash of
  `user_id` over healthy pods (so a reconnect lands on the pod holding presence). Signals
  SIGTERM → drain: stop accepting `enqueue`, keep serving existing calls for up to 120s,
  notify clients to reconnect early, then close.
- **worker** on Fly.io machines, queue-driven autoscaling, no user-facing latency budget.
- **LiveKit**: managed (LiveKit Cloud) at launch for blast-radius reasons, with a self-hosted
  fallback architecture documented; region pinned per call. TURN via LiveKit's embedded TURN.
- **State**: Neon (system of record), Redis Cluster (ephemeral: queues, presence, rate limits,
  cooldown caches), R2 (evidence, immutable + lifecycle), Cloudinary (public-ish media).
- **Regional launch toggles** live in Postgres (`feature_flags`, `market_policies`) and are
  read into a 30s-TTL cache in realtime; a kill switch per region exists at both the edge
  (Cloudflare) and the matcher.

## 7. Failure modes and the intended behaviour

| Failure | Behaviour |
|---|---|
| Redis shard primary loss | Cluster failover; queues are ephemeral, so in-queue users get `requeue_required` and auto re-enqueue; matched calls unaffected (media is SFU-side) |
| Realtime pod crash | Presence key expires in 15s; clients reconnect to another pod, resume `call_id` if media still alive, else `call_ended` |
| LiveKit region outage | New match attempts in that region fail fast to `region_unavailable`; clients see a retry, never a dead room |
| Moderation provider outage | Elevated-risk sampling falls back to secondary provider; if both down, high-risk callers are held in `review_required` (no silent pass), low-risk continues with sampling queued for later scoring |
| Postgres primary loss | Read paths degrade to cached; writes queue in web with bounded retry; matching continues because it does not depend on Postgres per match |
| Evidence bucket outage | Report still opens a case with metadata; upload retried with backoff for 24h; case flagged `evidence_pending` |
| Stripe webhook storm | Idempotent handlers + dedupe table; ledger cannot double-credit |

## 8. What is deliberately not in this architecture

- No P2P media. It leaks IPs between strangers and makes server-side safety sampling
  impossible. ADR-0004.
- No client-side-only enforcement of anything (age, bans, caps, entitlements).
- No per-match database write. `calls` rows are written asynchronously by the worker from
  call lifecycle events; matching never waits on Postgres.
- No global queue. Region- and language-partitioned by design; cross-region matching is an
  explicit, policy-gated exception for low-population queues.

## 9. Open questions blocking sizing

1. Launch markets and therefore age-assurance tiers, retention and moderation SLAs.
2. Mean call duration assumption (240s assumed). If it is 60s, peak match rate triples and
   Redis/LiveKit sizing changes materially.
3. Managed LiveKit at launch vs self-hosted from day one (cost vs control).
