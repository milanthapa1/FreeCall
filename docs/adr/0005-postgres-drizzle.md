# ADR-0005 — Postgres (Neon) as system of record, Drizzle ORM, no DB on the match path

- Status: accepted
- Date: 2026-10-30

## Context

The product needs strong consistency for money (coin ledger), safety decisions (bans, cases),
and identity (age state), plus very high write volume for call records and chat. Matching must
not depend on the primary database. The team writes TypeScript end to end.

## Decision

- **Neon Postgres 16**, one primary per environment, pgbouncer in transaction mode for app
  connections (`?pgbouncer=true&connection_limit=...`), direct connection reserved for
  migrations and `drizzle-kit`.
- **Drizzle ORM + drizzle-kit** for schema and migrations. SQL-first where the ORM is awkward
  (Lua-adjacent aggregates, partial indexes, partitioning, `FOR UPDATE` in ledger paths are
  written as `sql` fragments and reviewed as SQL).
- **uuid v7 generated in the application** (`uuidv7()` helper in `packages/db`) so IDs are
  time-sortable and inserts stay index-friendly without DB extensions.
- **Money and safety tables are strongly consistent** and written inside transactions with
  `SERIALIZABLE` where invariants span rows (ledger balance, ban escalation).
- **Call lifecycle is asynchronous**: `apps/realtime` emits lifecycle events; `apps/worker`
  writes `calls` rows and closes them. A lost lifecycle event is repaired by a reconciler that
  compares LiveKit room history to `calls` (idempotent on `call_id`).
- **Large append-only tables are partitioned monthly by `created_at`**: `calls`, `messages_dm`,
  `moderation_events`, `audit_logs`, `coin_ledger`. Default partition + automated `pg_partman`-style
  job in the worker (plain SQL, no extension dependency at launch).
- **Read replicas** are added at Phase 5 for admin analytics and reporting only; the console's
  case queue reads the primary until replica lag is proven < 1s.
- Every migration is expand/contract: add nullable → backfill in batches → enforce → drop old,
  with a note in `docs/data-model.md` and a rollback plan. Destructive migrations are blocked
  in CI by a migration linter.

## Consequences

Positive: one consistent store for the invariants that matter, typed queries, fast local dev via
docker Postgres, cheap branching for previews on Neon. Negative: transaction-mode pooling breaks
session-level features (advisory locks, `SET` persistence) — banned by lint; horizontal write
scaling is eventual (partitioning first, then sharding by `user_id` only if forced).

## Alternatives rejected

- **PlanetScale/MySQL**: weaker JSON, partitioning and `SKIP LOCKED` ergonomics for this workload.
- **Prisma**: heavier runtime, weaker SQL escape hatch, migration model we do not want for
  partitioned tables.
- **Event-sourced call store**: over-engineering; calls are not money.

## Revisit trigger

Primary write throughput > 60% sustained, or p95 commit latency > 20ms, or a need for
multi-region active-active writes (which would force a redesign of the ledger, not just the DB).
