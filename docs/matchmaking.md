# Matchmaking

Goal: p95 time-to-match < 2s at 1M concurrent, no safety constraint ever relaxed, and a
reproducible proof of 50k matches/s in staging.

## 1. Keys and sharding

Shard key = **region**. Every key a match touches carries `{region}` as a hash tag, so all
queues of a region live in one Redis slot and language/mode widening stays atomic:

```
mm:{iad}:{en}:{solo}:q        zset  score = enqueued_at_ms - priority_boost_ms
mm:{iad}:{en}:{solo}:m        hash  sid -> entry json (region, country, langs, mode, band, age_tier)
mm:{iad}:ex:{sid}             zset  member = peer sid, score = exclusion_expiry_ms (blocks: 2^41)
mm:{iad}:claim:{sid}          str   "1" NX EX 10 — prevents double-pairing across scripts
presence:{sid}                str   pod id + socket id, EX 15 (global, not sharded)
```

Entry payload is small and hot: `{"c":"DE","l":["en","de"],"b":2,"t":"t1","g":"m","p":0}` (country,
languages, trust band, age tier, own gender for preference matching, priority).

Exclusions are duplicated per region the user may match in (max 3 by default), written by the
worker on block creation and on call end. Bounded: 500 blocks, 32 recent partners, 30-min TTL.
A block is a far-future score so pruning never removes it.

## 2. `pop_pair` contract

Called once per enqueue and on every widening step. Returns either a pair or `wait`.

```
KEYS[1..n]  candidate queue zsets, in preference order (exact, lang-widened, ...)
KEYS[n+1]   my exclusion zset               mm:{region}:ex:{sid}
KEYS[n+2]   my claim key                    mm:{region}:claim:{sid}
KEYS[n+3]   partner exclusion key template  (computed by caller per candidate)
ARGV        sid, now_ms, my_entry_json, max_probes, cooldown_sec, trust_band
```

Steps:

1. `ZREMRANGEBYSCORE` my exclusion set with `-inf now` (drop expired cooldowns).
2. If `EXISTS claim:{sid}` → return `already_claimed`.
3. For each queue in order, `ZRANGE 0 max_probes-1 WITHSCORES` (max 50). For each candidate:
   - skip self, skip entries whose heartbeat expired (`now - enqueued_at > 20_000` and not
     refreshed — a stale entry is `ZREM`'d),
   - skip if candidate is in my exclusion set, or I am in theirs (`ZSCORE` both ways — both keys
     are in this slot),
   - skip if country preference is not mutual (`my.country != 'any' && != cand.country`),
   - skip if my `own_gender` preference is strict and candidate gender doesn't match,
   - compute `band_delta = |my.band - cand.band|`; never pair `low` with `high` (band gap > 1 is
     a hard reject),
   - keep the best candidate by `(band_delta, -wait_ms)`, first-found wins ties.
4. If a candidate is chosen: `ZREM` both queues, `ZREM` both metadata hashes, write
   `recent` entries into both exclusion sets with score `now + 1_800_000`, set both claim keys
   `NX EX 10`, return `{a, b, a_entry, b_entry, queue_key, matched_at}`. Atomic — both users are
   removed in the same script.
5. Else return `wait` with the number of probes used (for observability).

Scripts are loaded with `SCRIPT LOAD` at boot, invoked with `EVALSHA`, and fall back to `EVAL` on
`NOSCRIPT`. Every script is exercised against a real Redis in CI, including replay after a
simulated failover.

## 3. Widening schedule

| Elapsed | Relaxation | Never relaxed |
|---|---|---|
| 0s | exact: region + language + mode + country prefs | age gate, bans, blocks, cooldowns, band gap |
| 5s | language (fall back to region default languages, user must have opted into "any") | as above |
| 10s | region (borrow from neighbour only if `cross_region_borrow` flag and RTT budget < 150ms) | as above |
| 20s | mode (solo may match couple only if both opted in) | as above |
| 45s | give up with `no_match` + honest copy, offer to widen manually | as above |

Widening is driven by a per-socket timer in the realtime process, not by a cron. Each step
re-runs `pop_pair` with a different candidate list; the claim key makes cross-slot steps safe.

## 4. Match → connect → requeue

1. Script returns a pair. Realtime assigns `call_id` (uuid v7), creates the LiveKit room and two
   tokens (60s TTL), and emits `matched` to both sockets within the same event loop tick.
2. Each client sends `joined` when `Room.on(Connected)`. If **both** `joined` within 8s, the call
   is `active` and `connected_at` is recorded.
3. If either fails: close the room, emit `call_failed` with `retry` to both, and requeue both
   with `priority_boost = 10_000ms` (they jump the queue but keep their original `enqueued_at`
   for fairness accounting). `call_id` stays the idempotency key for the lifecycle event.
4. If a client disconnects during the call without `stop`, the partner gets `partner_left` after
   a 5s grace; the disconnected user has 10s to reconnect and resume the same `call_id`, after
   which the call is closed.

## 5. Fairness, priority and abuse

- Priority boost comes from an entitlement (`priority_matching`) and from failed setups; it is
  capped at 60s so paying users cannot starve a market indefinitely.
- A user who skips more than 6 times in 60s is softly throttled (boost removed, 1s enqueue
  delay) to protect partners from serial skippers. Repeated within an hour → `skip_flood` shadow
  flag for the safety pipeline.
- One socket has at most one active queue entry and one active call. Violations are rejected with
  `already_enqueued` / `already_in_call`.
- Enqueue is refused for banned, locked, `t3_locked`, `review_required`, or over-cap guests,
  checked server-side from cached state (Redis `ban:{user}`, `age:{user}`, `cap:{user}:{date}`).

## 6. Failover behaviour

| Event | Behaviour |
|---|---|
| Shard primary down | Cluster promotes replica; in-flight pairings in the script either committed or not (atomic). Clients in queue get `requeue_required` after presence expiry and re-enqueue with original `enqueued_at`. |
| `claim` key orphaned | 10s TTL; a stuck user retries and the claim expires. |
| Realtime pod lost | Presence expires in 15s; queue entry becomes stale and is skipped, then pruned. Partner sees `partner_left`. |
| Region unavailable | Router removes region; new enqueues go to neighbour; existing calls finish or fail to `region_unavailable`. |

Invariants asserted in tests and in the simulator:

1. A pair is never created if either side blocked the other.
2. A pair is never created for partners seen in the last 30 minutes.
3. Country preferences are mutual or the pair is not created.
4. Neither participant is in two calls at once.
5. Every `matched` event has exactly one `call_id`, and every `call_id` has at most one active
   room.
6. Band gap > 1 never pairs.

## 7. Simulator (deterministic)

`packages/testing/sim` — virtual clock, seeded PRNG (xorshift128+), event queue. Models:

- arrivals (Poisson, configurable rate), call duration (log-normal, default mean 240s),
- country/language/mode mix, block graph (random geometric), trust bands,
- skip probability by call age, disconnect probability, setup-failure probability,
- widening timers and the exact `pop_pair` semantics against the real Lua script.

Outputs: TTM histogram (p50/p95/p99), match rate/s, invariant violation count (must be 0),
queue depth over time, per-band pairing matrix. `--seed` and `--scenario` make runs reproducible;
a golden-file test asserts the p95 for a fixed seed does not regress by more than 5%.

## 8. Load test (k6)

Two scenarios:

- `match-throughput`: N synthetic users, each with a minted JWT, connect via WebSocket, enqueue,
  and on `matched` immediately `skip` to re-enqueue — this drives the pop path at the target
  rate rather than waiting on real call durations. Ramps 1k → 50k matches/s over 5 minutes, holds
  5 minutes, ramps down. Success: error rate < 0.1%, p95 `pop` < 5ms, Redis CPU < 70%, zero
  invariant violations.
- `soak-calls`: 500 real pairs (Chromium in Playwright farm) for 30 minutes to measure connect
  success, media quality and memory; separate from the throughput number.

k6 runs in-cluster (k6 operator) against a dedicated staging region with production-shaped Redis
(6 shards) and no LiveKit dependency for the throughput scenario. Results are committed under
`docs/reports/` with the git SHA, image digests and instance types, because a throughput claim
without that context is marketing.
