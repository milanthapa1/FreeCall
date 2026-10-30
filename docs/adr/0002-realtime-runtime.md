# ADR-0002 — Realtime service: Node 24 LTS + uWebSockets.js

- Status: accepted (Phase 0), with an explicit fallback to Go
- Date: 2026-10-30

## Context

The signaling service holds ~1M concurrent WebSockets, receives a small typed message per
event (1–2KB), performs a Redis round trip per enqueue and emits match events. It must drain
gracefully, expose precise metrics, and share the zod protocol with the TypeScript clients so
that a field cannot mean two things. Candidate runtimes: Node + uWebSockets.js, Go, or Elixir.

## Decision

Node.js 24 LTS with `uWebSockets.js` for the socket layer, plain TypeScript for handlers,
`ioredis` in cluster mode for queue operations. No HTTP framework; the same process serves
`/healthz`, `/readyz` and `/metrics` on a separate loopback port.

Non-negotiable implementation rules:

- One message = one parse = one validation; unknown fields are rejected before dispatch.
- No `await` between reading presence and writing the match result without a guarded
  compensation path; matching is Redis-atomic, not process-atomic.
- Per-socket token buckets, per-IP connection caps, and a 16KB frame cap enforced in uWS
  (`maxPayloadLength`), not after allocation.
- SIGTERM: stop accepting `enqueue`, respond `draining` to new matches, hold existing calls,
  close after 120s or when empty.
- Native module is built in the Docker image; local Windows dev runs realtime in Docker if the
  prebuilt binary for the local Node version is missing. CI builds for linux/amd64 + arm64.

## Consequences

Positive: one language and one schema across web/realtime/worker; protocol changes are a single
PR; very high socket density per core; easy hiring. Negative: native dependency, GC pauses must
be monitored (`perf_hooks` event-loop lag > 50ms pages), and a 1M-socket process needs careful
heap sizing (`--max-semi-space-size`). Node 26 is not the target; uWS binaries lag new majors.

## Fallback trigger (documented, not improvised)

If any of the following holds at Phase 2 load test, the matcher/signaling moves to Go behind the
same protocol package (JSON Schema generated from zod, parity tested):

1. p99 event latency > 25ms at 100k sockets/pod after tuning.
2. uWS cannot be built for the pinned Node LTS in CI for two consecutive weeks.
3. Two production incidents trace to event-loop starvation under normal load.

## Alternatives rejected

- **Go**: excellent fit technically, but doubles the schema surface; kept as the fallback.
- **Elixir/Phoenix**: great concurrency story, weakest hiring pool for this team and a second
  language for the moderation/worker logic.
- **Socket.IO / ws**: materially lower density and more per-message overhead at 1M sockets.
