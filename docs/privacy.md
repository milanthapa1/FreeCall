# Privacy

Privacy is a product constraint here, not a policy page. This document is the engineering
counterpart to the privacy notice and the DPIA; final retention values require legal sign-off
(open question 1).

## 1. Data inventory

| Data | Purpose | Lawful basis (GDPR framing) | Storage | Retention |
|---|---|---|---|---|
| Session cookie / token hash | Authentication | Contract | Postgres | Session lifetime + 7d |
| User id (uuid v7) | Identity, safety linkage | Contract | Postgres | Until deletion + 30d |
| Email | Account, security notices | Contract | Postgres | Until deletion + 30d |
| Age tier + provider ref | Age assurance (legal obligation) | Legal obligation | Postgres | Account lifetime + 12 months |
| DOB / ID documents | Never stored by us | — | Provider only | Provider policy |
| Age band (`18-20`, `21-24`, `25+`) | Safety, product | Legitimate interest | Postgres | Account lifetime |
| Device fingerprint hash | Ban evasion, rate limiting | Legitimate interest | Postgres | 90d after last seen |
| IP hash (salted) | Abuse detection | Legitimate interest | Postgres | 90d |
| Raw IP | Rate limiting, edge security | Legitimate interest | Cloudflare / Redis | ≤ 24h |
| Call metadata (ids, times, region, end reason) | Safety, billing, analytics | Contract / legitimate interest | Postgres | 13 months |
| In-call chat | Real-time only | Contract | Memory (ring buffer) | Deleted at call end; 50 messages copied to evidence on report only |
| DM content (Phase 4) | Service | Contract | Postgres | 12 months or account deletion |
| Report + evidence | Safety, legal defense | Legal obligation / legitimate interest | R2 + Postgres | See §2 |
| Moderation events + audit logs | Accountability | Legal obligation | Postgres | 24 months |
| Money records | Tax/accounting | Legal obligation | Postgres | 7 years (jurisdiction-dependent) |
| Product analytics | Improvement | Consent | PostHog | 12 months, aggregated after |
| Traces/metrics | Operations | Legitimate interest | OTel backend | 14 days raw, 13 months aggregates |
| Error reports | Operations | Legitimate interest | Sentry | 30 days |

Not collected, by design: real name, address, contacts, precise location, browsing history,
advertising identifiers, biometric templates (age estimation returns a band, not a template),
screen recordings, call recordings.

## 2. Evidence retention

| Category | Retention | Notes |
|---|---|---|
| Automated frame, no violation | 7 days | Deleted by lifecycle rule; never attached to a case |
| Case evidence (report or confirmed violation) | 30 days after case closure | |
| Case with an appeal | 90 days after final appeal decision | |
| Ban record (metadata only, no media) | Life of ban + 2 years | Needed for recidivism and appeals |
| CSAM-suspect object | Indefinite legal hold | Segregated prefix, no routine deletion, legal workflow only |
| Law-enforcement preservation request | Per request, minimum 90 days | Legal-only, logged |

Deletion is performed by R2 lifecycle rules **and** a nightly reconciliation job that removes
orphans and asserts the two agree. Deletion runs are logged with object counts, never contents.

## 3. Data subject rights

- **Access/export**: self-serve request in settings; async job assembles a JSON + media bundle
  (profile, calls metadata, DMs, reports filed by the user, coin ledger), delivered via a signed
  URL valid 24h. Target 7 days, hard limit set by law (30 days GDPR / 45 days CCPA).
- **Deletion**: immediate session revocation and soft-delete; hard purge job within 30 days
  removes or irreversibly pseudonymizes personal data. **Exceptions are enumerated in the export
  report itself**: evidence under legal hold (opaque `subject_ref` retained), financial records
  (statutory), ban metadata (safety/recidivism), aggregated analytics. A user is told which
  category applies to them, not just "some data may be retained".
- **Objection/restriction**: analytics consent toggle is immediate; marketing opt-out immediate.
- **Rectification**: profile fields self-serve; age tier is only changed by the assurance
  provider or a human reviewer.
- Requests are tracked with an SLA timer; a missed deadline is a SEV2 operational incident.

## 4. Children and minors

- The service is 18+. Age gating is the control (ADR-0006). If a minor is identified, the account
  is locked, sessions revoked, and data handled per the minors policy: minimal retention, no
  marketing, and deletion on request without requiring an account.
- Analytics and marketing pixels are not loaded for `t3_locked` or suspected-minor sessions.
- Actual-knowledge cases follow the CSAM workflow in `moderation.md` §4, including NCMEC/ESP
  reporting where applicable. Legal, not engineering, decides the reporting obligation.

## 5. Transfers, processors, and residency

| Processor | Data | Region | Safeguard |
|---|---|---|---|
| Neon | All Postgres data | Configurable per environment | DPA, SCCs where needed |
| Cloudflare (R2, WAF, Turnstile) | Evidence, edge logs | Global / regional buckets | DPA, SCCs |
| LiveKit | Media streams (transient), room metadata (no PII) | Per-region | DPA, no recording |
| Cloudinary | Avatars, social photos | US/EU | DPA |
| Hive / Sightengine | Frames (transient) | US | DPA, no training on our data (contractual) |
| OpenAI | Text snippets | US/EU endpoint | DPA, zero retention mode |
| Age assurance provider | ID/selfie (never stored by us) | Per provider | DPA, retention limits |
| Stripe | Payment data | Global | PCI DSS, DPA |
| Sentry / PostHog | Errors / product events | EU or US per market | DPA, PII scrubbing |

Market-level residency (data stays in-region) is a per-market policy flag. Markets that require
it get a dedicated Neon project, R2 jurisdiction and PostHog region; the trade-off is higher cost
and operational complexity, decided in ADR-0018 once the market list is fixed.

## 6. Privacy engineering rules

1. No PII in logs, traces, URLs, error messages or analytics events (enforced by types,
   ADR-0012).
2. Collect only what a feature uses. New fields require a purpose, a retention class and a
   privacy review in the PR template.
3. Pseudonymize at the boundary: analytics and moderation vendors see `u_<hash>`, never emails.
4. Frames are transient by default; persistence is an exception with a case id.
5. Retention is code: a job, a test, and an alert if it fails.
6. Consent is enforced server-side: PostHog is not initialized until the consent API says yes.
7. Deletion reaches backups by expiry, not by editing backups. Backups have a 30-day maximum
   lifetime, documented.
8. Every new processor requires a DPA before production traffic, tracked in
   `docs/processors.md` (Phase 1).

## 7. DPIA triggers

A DPIA is required before launch and again if we add: face recognition or biometric templates,
recording or replay, precise location, cross-site tracking, ad targeting on sensitive categories,
or a new market with a stricter regime. The current design deliberately avoids the first three.
