# ADR-0013 — Multi-region realtime with sticky routing and 120s drain

- Status: accepted
- Date: 2026-10-30

## Context

A socket-heavy service that redeploys must not drop live calls, and a regional failure must not
take down the product globally. Users must be pinned to the region that owns their presence and
to the pod that holds their queue slot; otherwise `skip` and reconnect become ambiguous.

## Decision

- **Regions**: `iad`, `sfo`, `lhr`, `fra`, `bom`, `sin`, `syd`, `gru`, `jnb`, `nrt`. Client picks
  by measured RTT (not geo-IP alone) and the choice is recorded on the session; live calls never
  migrate regions.
- **Sticky routing**: consistent hash ring over healthy pods, keyed by `user_id`. Cloudflare/Fly
  anycast sends the initial TLS connection; a small routing service (or Fly's `fly-replay`) pins
  the socket to the pod that owns the key. On ring change, the affected key space rehashes and
  clients reconnect — bounded to ~1/N of keys per change.
- **Two independent presence records**: `presence:{sid}` in the region's Redis (authoritative,
  15s TTL) and a local process map (fast path). A connection on the wrong pod is redirected, not
  served.
- **Drain on deploy**: SIGTERM → `/readyz` fails immediately (LB stops new connections) → create
  is refused, `enqueue` returns `draining` → existing sockets get `server_draining` with
  `retry_after_ms` jittered 2–10s → wait for calls to end or 120s cap → close 1012. In-flight
  media is unaffected (SFU-side). The client reconnects and resumes `call_id` if the room is
  still alive, else gets `call_ended`.
- **Rolling updates** are surge-first (`maxSurge=25%`, `maxUnavailable=0`), one region at a time,
  never during a regional incident, gated by the error-budget policy in `slo.md`.
- **Regional evacuation**: a kill switch drains all pods in a region and marks the region
  `unavailable` in the routing table; clients are told to use the next-nearest region for new
  matches. Existing calls continue until natural end if the region is merely degraded.
- **Cross-region matching** is disabled by default; a queue with <20 users for 20s may borrow
  from a neighbour only if both users' country preferences allow it and latency budget is <
  150ms RTT. This is a policy flag, not an automatic behaviour.

## Consequences

Positive: deploys are invisible, failures are contained, latency is regional. Negative: rehash
storms on pod loss (mitigated by small rings and jitter), routing service complexity, and
per-region Redis + LiveKit cost even at low traffic in a region (mitigated by launch toggles).

## Alternatives rejected

- **Single global region**: unacceptable latency for half the world and a single blast radius.
- **DNS-only failover**: too slow (TTL) and breaks established sockets.
- **Queue in one region, media in another**: doubles latency and complicates spend/abuse policy.

## Revisit trigger

A region's traffic falls below the cost floor for two consecutive months, or a cloud provider
offers anycast WebSocket with session affinity strong enough to remove the routing service.
