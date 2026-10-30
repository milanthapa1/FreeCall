# ADR-0008 — Tiered frame sampling: server egress where it matters, client frames as advisory

- Status: accepted
- Date: 2026-10-30

## Context

The spec asks for server-side frame sampling from LiveKit egress every 3–5s per participant.
At 1M concurrent participants that is ~250k frames/s. LiveKit participant/composite egress is
priced and provisioned per stream, so full coverage is neither technically nor commercially
viable (rough order: thousands of egress instances, tens of thousands of dollars per hour).
Client-side capture is free and universal but untrusted: a modified client can send anything,
including a clean frame while showing something else.

## Decision

Sampling is a function of risk, and the *decision to trust* a frame is explicit.

| Tier | Who | Capture | Rate | Trust |
|---|---|---|---|---|
| A | Low trust: `t0` guests, new accounts, recent strikes, shadow-flagged, high IP reputation risk | LiveKit participant egress (server) | 1 frame / 3s | Authoritative |
| B | Normal: verified adults with clean history | Client canvas capture, JPEG q0.7, signed upload | 1 frame / 5s | Advisory (can flag, cannot alone permanently ban) |
| C | Elevated: medium-confidence hit | Server egress | 1 frame / 2s, plus client frames | Authoritative |
| D | Report-triggered | Server egress snapshot + client-reported frame + last 50 messages | one-shot | Bundle for human review |

Rules:

- Advisory (client) frames can trigger a *shadow* action and increased sampling. They cannot
  alone produce a high-severity permanent ban without a second corroborating signal (server
  frame, text evidence, or human review). Documented in `moderation.md`.
- Tier A coverage is capped by budget: if egress capacity is saturated, `t0` guests are queued
  behind `C`/`D`; the shortfall is a metric (`sampling_degraded_total`) and an alert, never a
  silent pass.
- Client frames are uploaded via short-lived presigned POSTs scoped to `call_id + participant`,
  max 1 per 2s, 256KB, content-type pinned, EXIF stripped server-side before classification.
- Frames are streamed to the classifier and **not persisted** unless (a) a violation is found,
  (b) a report is filed, or (c) the room is under review. Retention of persisted frames is in
  `privacy.md` (7 days, 30 days if attached to a case, legal hold beyond).
- The classifier path is provider-abstracted (Hive primary, Sightengine secondary) with a
  normalized label taxonomy in `packages/moderation`.

## Consequences

Positive: affordable, risk-proportional, and honest about the trust boundary. Negative: a
determined low-risk-looking abuser can evade client-side sampling (mitigated by report-driven
server capture and by trust decay); two code paths to test; egress capacity planning becomes a
safety budget line item.

## Alternatives rejected

- **Server-side for everyone**: cost and egress-instance scale make it fiction at 1M CCU.
- **Client-only**: trivially bypassed; unusable as the sole basis for enforcement.
- **On-device ML**: privacy-preserving and cheap, but adds a large model to the critical path,
  is bypassable, and produces no auditable evidence. Interesting for Phase 6 as a *pre-filter*,
  not an authority.

## Revisit trigger

Egress pricing drops below ~$0.30/1k sampled minutes, or violation detection recall on client
frames proves materially worse than server frames in the quarterly audit.
