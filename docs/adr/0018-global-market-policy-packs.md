# ADR-0018 — Global launch via versioned market policy packs, fail-closed defaults

- Status: accepted (decision owner: product/legal)
- Date: 2026-10-30
- Supersedes: none. Constrains ADR-0006, ADR-0009, ADR-0013.

## Context

The product is to be available **worldwide** at launch. Age-assurance requirements, evidence
retention, CSAM reporting authorities, consumer-law obligations, payment availability and data
residency differ per jurisdiction. Hardcoding a handful of markets, or defaulting an unknown
country to "serve it and sort it out later", would mean operating unlawfully by accident in
whichever country we forgot.

## Decision

**Every request resolves to exactly one market, server-side, and every market has an explicit
policy row.** Absence of a row means *not served*, not "default allowed".

1. **Market resolution.** From the edge (`CF-IPCountry` / Fly region), never from a client field.
   A user cannot select a different market to escape policy. Travel is handled by re-resolving on
   each new session; an account's market is the one it is currently served in, recorded on the
   session. VPN/proxy signals reduce trust and can force re-assurance; they never change policy.
2. **Service classes** (`market_policies.service_class`):

   | Class | Meaning | Age gate | Monetization |
   |---|---|---|---|
   | `full` | all features | `t1` guest / `t2` for DMs, uploads, payouts | yes |
   | `strict` | regulated high-scrutiny | `t2` before first match | yes, if consumer law allows |
   | `limited` | matching + safety only | `t1` | no |
   | `blocked` | not served (sanctions, no lawful path, no moderation coverage) | n/a | no |

   Unknown or missing row ⇒ treated as `blocked` and alerts. This is the only safe default.
3. **Age assurance mapping** is per row (`required_age_tier`, `guest_minutes_per_day`), reviewed
   by counsel. Engineering ships the mechanism and a conservative seed; Legal owns the values and
   the `legal_signoff_ref`. A market cannot be enabled without a sign-off reference.
4. **Data residency** (`residency`: `global | eu | us | in | br | au | …`) is a mechanism, not a
   promise to deploy 190 stacks. Markets that legally require local storage get a pinned Neon
   project + R2 jurisdiction + PostHog region; everything else uses the global stack with SCCs.
   At launch we implement `global` and `eu`; other values fail closed (`blocked`) until an
   operator provisions them.
5. **CSAM reporting authority** (`reporting_authority`: `ncmec | national:<code> | both |
   pending_legal`). A market with `pending_legal` is `blocked`. Legal files; engineering only
   preserves evidence and surfaces the required identifiers.
6. **Sanctions and export controls.** A static, reviewed blocklist overlays the policy table
   (edge geo rules + server check + payment restriction). It is versioned with the pack and
   reviewed quarterly, because sanctions lists change.
7. **Moderator coverage is a launch gate.** A market can only be `full`/`strict`/`limited` if
   `moderator_coverage` confirms 24/7 human coverage for its top languages. Turning on a market
   without coverage is queue growth, not moderation.
8. **Policy packs are versioned data, not deploys.** `policy_version`, `effective_at`, `signer`,
   `changelog`. Changes are audited, canary-rolled by market cohort, and reversible with a flag.
   Realtime caches the resolved row for 30s; a kill switch disables matching per market instantly.
9. **Localization is a launch dependency.** Locale negotiation, RTL, per-market pricing and
   currency, and translated safety copy (rules, report reasons, ban notices, appeal form) are
   required for any enabled market. English fallback is not acceptable for safety copy.

## Consequences

Positive: one code path for every jurisdiction; adding a market is a reviewed data change;
forgetting a market fails safe; residency and reporting obligations are expressible rather than
buried in conditionals. Negative: legal work becomes a launch bottleneck for every market; the
seed table and its review cadence are real operational work; residency for a handful of markets
adds deployments we would otherwise avoid.

## Alternatives rejected

- **Serve everywhere, apply one global policy**: unlawful in strict markets, indefensible in an
  incident.
- **Hand-picked launch list**: contradicts the product decision; would need re-architecture later.
- **Client-side country selection**: trivially spoofable and unenforceable.
- **Per-market code branches**: combinatorial test surface, silent drift.

## Revisit trigger

A market's regulator publishes technical guidance that the policy schema cannot express, or the
number of `blocked` markets with meaningful demand justifies a dedicated residency stack.
