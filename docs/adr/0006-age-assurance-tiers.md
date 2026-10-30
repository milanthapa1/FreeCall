# ADR-0006 — Server-authoritative age assurance with risk tiers

- Status: accepted
- Date: 2026-10-30
- Owners: product, trust & safety, legal

## Context

The product is adults-only. Self-declaration is trivially bypassed and, in several markets, is
not a defensible control for a service with anonymous video. Full ID verification for every
visitor destroys conversion. Regulators (UK OSA, EU DSA/AVMSD, various US state laws) differ in
what is "highly effective" assurance and in what must be retained.

## Decision

Age state is a server-side record, never a client flag, and is a hard gate on `enqueue`.

**Tiers**

| Tier | Method | Capabilities |
|---|---|---|
| `t0_declared` | 18+ attestation + DOB entry, Turnstile, device+IP risk | 30 call-minutes/day, no DMs, no uploads, no profile, lower trust band, elevated sampling |
| `t1_estimated` | Provider age estimation from a selfie (no ID document retained) | Full MVP capabilities, 1 device, re-check every 12 months |
| `t2_verified` | Government ID + liveness via provider | Full capabilities, account recovery, appeals, monetization eligibility |
| `t3_locked` | Provider or moderator determined minor | No access; appeal path only |

`required_tier(market)` is configuration (`market_policies`), not code. A market may require
`t1` for guests, or `t2` for monetization/DMs.

**Provider abstraction** (`packages/providers/age-assurance`): `startVerification`, `getResult`,
`parseWebhook`, `deleteSubject`. Adapters for Yoti, Persona, Veriff. We store only
`provider`, `provider_ref`, `status`, `tier`, `verified_at`, `expires_at`, derived `age_band`
(e.g. `18-20`, `21-24`, `25+`), and a decision hash. **Raw documents, selfies and liveness
frames are never stored by us**; retention is the provider's, governed by contract.

**Rules**

- A failed or abandoned verification leaves the user at `t0` or lower; it never grants access.
- Webhooks are signature-verified, idempotent on `provider_ref + event_id`, and cannot lower a
  tier without a human-reviewed appeal.
- Device and IP signals may only *reduce* trust or trigger re-verification. They never
  substitute for assurance.
- A `t3_locked` decision deletes sessions within 60s and blocks enqueue on all devices.
- Guests can upgrade in place; the session keeps its `user_id`, so bans and evidence survive.

## Consequences

Positive: one gate, one state machine, per-market policy without deploys, minimal PII. Negative:
conversion cost of `t1` in markets that require it; provider dependency (two providers wired for
failover); we cannot "just check the box" in permissive markets without a documented risk
acceptance.

## Alternatives rejected

- **Self-declaration only**: not defensible for anonymous video at scale.
- **ID for everyone**: maximal assurance, unacceptable conversion and data liability.
- **Storing ID documents ourselves**: needless breach surface and retention obligation.

## Revisit trigger

A market regulator publishes specific technical guidance, or provider FP/FN rates on the
18–20 boundary exceed 2% in the quarterly audit.
