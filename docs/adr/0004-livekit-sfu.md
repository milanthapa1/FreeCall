# ADR-0004 — LiveKit SFU only; no peer-to-peer media

- Status: accepted
- Date: 2026-10-30

## Context

1:1 video can be P2P (cheapest, lowest latency, no server egress) or SFU-relayed. This product
connects strangers. P2P exposes each participant's IP address to the other, which is a
deanonymization and DDoS vector, and it makes server-side frame sampling for safety impossible.
OmeTV-style products are also a target for network-level abuse.

## Decision

All media goes through LiveKit (SFU). No P2P offer/answer/ICE in the protocol for MVP; the
`offer`/`answer`/`ice` events exist in the schema reserved for a future voice-only/P2P experiment
behind a flag, and are rejected in v1.

Configuration: 2-participant rooms, simulcast **off**, `dynacast` off, 480p/24fps/600kbps
default publish, 720p opt-in for entitled users, Opus 48kHz mono for voice, adaptive stream on
the subscriber side, TURN over TLS via LiveKit's embedded TURN for restrictive networks.
Rooms are created server-side with `emptyTimeout: 30`, `departureTimeout: 20`, and metadata
containing only `call_id` and `region` (no PII, no age data).

## Consequences

Positive: IPs are not exposed, media is samplable for safety, quality is centrally observable,
TURN is handled, egress scales horizontally. Negative: ~600Gbps aggregate egress at 1M CCU is
the dominant infrastructure cost; media latency depends on SFU placement (mitigated by
per-region clusters and pinning by client RTT); vendor dependency (mitigated by an adapter and
a documented self-hosted path).

## Alternatives rejected

- **P2P WebRTC**: rejected for safety and privacy, not performance.
- **Self-hosted LiveKit from day one**: operationally heavy for launch; revisit at Phase 5 when
  egress cost is measured.
- **Third-party video SaaS other than LiveKit**: the server SDK, egress and webhook model are
  the differentiator we need for moderation.

## Revisit trigger

Egress cost exceeds the per-call gross margin target, or a market requires in-country media
termination that the managed region set cannot satisfy.
