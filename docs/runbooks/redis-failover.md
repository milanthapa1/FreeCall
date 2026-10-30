# Runbook: Redis Cluster failover

**Trigger:** primary shard loss, AZ failure, planned Redis maintenance, or `redis_up == 0` alert.
**Expected user impact:** users currently waiting in a queue are told to retry; users in calls
are unaffected (media is SFU-side).

## Detect

- `freecall.redis.cluster_state != ok`, `pop_pair` error rate spike, `redis_command_failures`.
- Synthetic check in the affected region failing for 2 consecutive minutes.

## Immediate actions (0–5 min)

1. Confirm scope: one shard vs whole cluster vs one region. Check the provider status page and
   the cluster `CLUSTER INFO` from a bastion.
2. If one region only: enable the region kill switch (`feature_flags.region_<code>_matching =
   false`) so new enqueues route to the neighbour. Existing calls continue.
3. Realtime enters degraded mode automatically: `enqueue` returns
   `requeue_required{reason:"failover"}`, clients re-enqueue once with jitter.
4. Page the platform on-call if not already paged. Open an incident channel; set severity SEV2
   (SEV1 if > 2 regions or > 5 min).

## Verify correctness

- **Duplicate pairing check**: run `scripts/audit-duplicate-calls.ts --since 15m`. Any user with
  two active `call_id`s is a P1 bug; the worker closes the older room with
  `end_reason="error"` and opens a case.
- **Lost match check**: compare `enqueue` count vs `matched` + `no_match` + errors for the window;
  a shortfall means events were lost — acceptable for queued users, never for connected ones.
- **Presence sanity**: `presence:*` count should return to ~the number of live sockets within
  30s. Stale keys expire on their own (15s TTL).

## Recovery

1. Let the cluster promote the replica. Do not manually fail back; the old primary rejoins as a
   replica and is resynced.
2. Once `cluster_state:ok` for 5 minutes, re-enable the region.
3. Warm the exclusion sets: `scripts/rebuild-exclusions.ts --region <code>` rehydrates blocked
   pairs and recent partners from Postgres. Run this **before** re-enabling matching if the
   shard was replaced (not merely failed over), because exclusion sets are in-memory only.
4. Confirm p95 TTM returns to baseline within 10 minutes.

## Data-loss expectations (documented, accepted)

Queues, claims, presence, cooldowns and rate-limit buckets are ephemeral. Their loss costs users
a retry, never a duplicate call, because `call_id` allocation and room creation are idempotent and
the claim keys have short TTLs. The **only** durable queue-adjacent data is `blocks`, which lives
in Postgres and is rebuilt by the script above.

## Post-incident

- Timeline, blast radius, whether safety sampling degraded, and whether any evidence write failed.
- If safety sampling degraded, T&S must review the affected window for unreviewed high-severity
  signals (the backlog is drained automatically, but a human confirms completeness).
- Add the failure mode to the chaos suite if it was not already covered.
