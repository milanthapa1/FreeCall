# ADR-0003 — Redis Cluster with sharded queues and Lua matching

- Status: accepted
- Date: 2026-10-30

## Context

Matching must pair two waiting users atomically under contention, respect mutual country
preferences, exclude blocked pairs and recent partners, prefer similar trust bands, and widen
progressively. It must sustain ~6.3k matches/s peak (50k/s burst) while staying p95 < 2s.
Postgres is the wrong tool: row locks and WAL writes per attempt would dominate. A single Redis
node cannot hold the write rate or survive a zone loss.

## Decision

Redis Cluster (6+ nodes, 3 AZs, TLS, AUTH) with:

- Queue keys `mm:{region}:{lang}:{mode}` — the hash tag is the shard key, so a single script
  touches only keys in one slot.
- Exclusions are **materialized per shard**: when a block is created or a call ends, the worker
  writes `ex:{shard}:{sid}` sets (blocked peer ids, recent partner ids with 30-min TTL) into
  every shard that could match that user (region × languages the user accepts). Size is bounded
  by the block list cap (500) and recent-partner cap (32), so each set is small and TTL'd.
  This is deliberate duplication: it keeps the hot Lua path single-slot and O(1)-ish.
- A candidate scan is bounded (max 50 probes per `pop_pair`) and returns the best trust-band
  match found; no unbounded `SMEMBERS`.
- Presence `presence:{sid}` TTL 15s, heartbeat 5s; the enqueue entry itself carries a TTL and
  is refreshed by heartbeat.
- Lua scripts (`pop_pair`, `requeue_priority`, `release_partner`, `drain_shard`) versioned in
  `apps/realtime/lua/`, loaded with `SCRIPT LOAD` at boot and invoked via `EVALSHA` with
  `NOSCRIPT` fallback. Unit-tested against a real Redis in CI (no mocks for Lua).
- Priority is `score = enqueued_at - priority_boost`; `ZADD` + `ZPOPMIN` inside the script.
- Cluster failover: queues are ephemeral by definition. On failover, in-queue users receive
  `requeue_required` and re-enqueue with their original `enqueued_at` so fairness is preserved.

## Consequences

Positive: atomic pairing, predictable tail latency, horizontal scale by shard, no DB on the
hot path. Negative: exclusion fan-out on block creation (bounded, async), duplicate state to
reconcile, and a failover that drops queue position (accepted; users are told to retry).

## Alternatives rejected

- **Postgres advisory locks / SKIP LOCKED**: 6k matches/s with two-sided constraints is a lock
  convoy; also couples matching availability to the primary DB.
- **Single Redis + sentinel**: cannot scale to the memory/throughput target or survive AZ loss.
- **Kafka/stream-based matcher**: adds seconds of latency and operational surface for no
  correctness gain.
- **Client-side pairing**: impossible to enforce safety constraints.

## Revisit trigger

Sustained queue memory > 4GB per shard, or p99 `pop_pair` > 5ms, or the exclusion fan-out
exceeds 2s p95 on block creation.
