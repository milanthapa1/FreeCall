# ADR-0011 — Zod-first versioned protocol, strict on the wire

- Status: accepted
- Date: 2026-10-30

## Context

Web, realtime and (later) mobile clients exchange events. Undetected schema drift produces the
worst class of bug: silent mismatches that only appear under load or on one platform. The
service must also survive hostile input from a client that is not ours.

## Decision

`packages/protocol` is the single source of truth.

- Every event is a discriminated union on `type` with a `v` (protocol version, integer) and a
  `seq` (per-connection monotonically increasing client counter). Envelope:
  `{ v, type, id, seq?, ts?, data }`.
- Schemas are `.strict()`: **unknown fields are rejected**. Strings are length-capped, enums are
  closed, IDs are branded UUIDs.
- Limits are part of the schema package and exported as constants: 16KB frame, 500-char chat,
  50-message report buffer, 16KB report payload, 8 events/s sustained and 20 burst per socket,
  1 typing/s.
- Server → client events carry the same envelope and are validated in tests against recorded
  fixtures, so a breaking change fails CI before deploy.
- **Compatibility policy**: additive optional fields are a minor bump (no `v` change); any
  rename, type change or semantic change bumps `v` and the server supports `v-1` for 30 days
  with a deprecation warning event. Unknown `v` → `unsupported_version` then close 4001.
- Generated JSON Schema + TypeScript declarations are build artifacts; the Phase 6 Go/RN clients
  consume the JSON Schema, with a parity test.
- Validation failures are **not** fatal for a single bad event: reply `protocol_error` with a
  correlation id and a machine-readable code, count it, and close the socket only on repeated
  violations (5 in 60s) or an oversized frame.

## Consequences

Positive: drift fails in CI, hostile input is bounded, clients get actionable errors, mobile
parity is testable. Negative: strictness means every new field is a deliberate protocol change
(slow, but that is the point); `v-1` support is real work and must be scheduled.

## Alternatives rejected

- **Protobuf/gRPC**: smaller on the wire, worse DX for browser debugging and TypeScript-first
  iteration; we are not bandwidth-bound on signaling.
- **Plain TypeScript types**: no runtime validation; unacceptable at the edge.
- **Passthrough zod objects**: invites unbounded payloads and silent drift.

## Revisit trigger

Signaling bandwidth becomes a measurable cost, or a native client needs schema evolution
guarantees stronger than `v`/`v-1`.
