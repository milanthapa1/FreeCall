# Security

Threat model summary. The system connects strangers, so the adversary is a motivated,
technically capable user with a script, not just a curious one. The highest-value targets are
the admin console, the evidence bucket, and provider credentials.

## 1. Assets

| Asset | Impact if compromised |
|---|---|
| Evidence bucket | Criminal exposure, victim re-trauma, regulatory action |
| Admin console / moderator sessions | Mass false bans, evidence access, reputational collapse |
| Provider keys (LiveKit, Hive, Stripe, age assurance) | Financial loss, impersonation, bypass of safety |
| Session tokens / JWTs | Account takeover, ban evasion |
| Coin ledger | Direct financial loss |
| User identity and age data | Regulatory and personal harm |

## 2. Threat model (abbreviated STRIDE)

| Threat | Vector | Control |
|---|---|---|
| Spoofing | Stolen session cookie, forged socket JWT | `__Host-` cookies, HttpOnly/Secure/SameSite, 60s JWT with `aud`, JWKS rotation, session binding to device id, rotation on privilege change |
| Tampering | Client sends `age_tier`, `trust_band`, `is_admin`, entitlement flags | Server derives all authority from DB; client values are preferences; zod strips/rejects unknown fields |
| Repudiation | "I never reported / never banned them" | Append-only `audit_logs` + `moderation_events` with actor, reason, before/after |
| Information disclosure | Evidence URL guessing, IDOR on `call_id`, transcript leakage | Opaque uuid v7 ids + authorization check on every read; presigned URLs ≤ 5 min; no public bucket; admin proxy only |
| DoS | Socket floods, expensive Zod payloads, report spam, enqueue churn | Edge WAF + Turnstile, per-IP/device/user token buckets, 16KB frame cap, bounded queues, per-route cost limits |
| Elevation of privilege | Route in `/admin` reachable with a user session; Server Action without authz | Audience-separated sessions, MFA, server-side `authz` call inside every action, Cloudflare Access, tests that assert 403 for each role/route pair |
| SSRF | Avatar URL fetch, link preview, webhook URL | No user-supplied URLs are fetched; Cloudinary public ids validated against a strict pattern; egress allowlist at the network layer |
| Supply chain | Malicious npm package in the admin bundle | Lockfile, `npm ci`, no postinstall in prod deps, provenance checks, SCA, review gate for new deps, CSP blocks inline script |
| Credential stuffing | Guest re-registration, leaked passwords | Magic link + OAuth first, passkeys later, Turnstile, IP reputation, no password reuse surface |
| Botnets | Mass guest sessions to spam/scam | Turnstile, device fingerprint clustering, per-ASN rate limits, trust-weighted reports, progressive challenge |

Explicitly out of scope for this document: physical security, insider legal process (covered in
`runbooks/csam-escalation.md` and the legal policy pack).

## 3. Web hardening

- **CSP** (nonce-based, `strict-dynamic`):
  `default-src 'self'; script-src 'self' 'nonce-{n}' 'strict-dynamic'; style-src 'self' 'nonce-{n}';
  img-src 'self' data: https://res.cloudinary.com; media-src 'self' blob:;
  connect-src 'self' https://api.{domain} wss://rt-*.{domain} https://*.livekit.cloud https://*.sentry.io https://*.posthog.com;
  frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none';
  upgrade-insecure-requests; report-uri /api/csp-report`.
  Admin routes use a stricter CSP with no PostHog/Sentry and no third-party frames.
- **Headers**: HSTS (1y, preload), `X-Content-Type-Options: nosniff`, `Referrer-Policy:
  strict-origin-when-cross-origin`, `Permissions-Policy: camera=(self), microphone=(self),
  geolocation=(), payment=()`, COOP/CORP where compatible with LiveKit, no `X-Frame-Options`
  reliance (use `frame-ancestors`).
- **CSRF**: Server Actions rely on Next.js origin checks; all non-action mutations use a
  double-submit token bound to the session. `SameSite=Lax` cookies. No state-changing GETs.
- **CORS**: explicit allowlist per environment for `/api/*`; credentials only for first-party
  origins; the realtime service accepts WebSocket upgrades only from allowlisted origins.
- **Cookies**: `__Host-` prefix, no `Domain`, `Path=/`, `Secure`, `HttpOnly`, signed, rotated on
  login and privilege change.
- **Client secrets**: build fails if any env var matching `/(SECRET|KEY|TOKEN|PASSWORD)/` is
  referenced from a module that ends up in a client bundle; enforced by a custom webpack/Turbopack
  plugin plus a bundle grep in CI.

## 4. API and data

- Every input is parsed by zod at the boundary; types are inferred, never asserted.
- Authorization is a separate step from authentication, in `packages/core/authz`, with a
  `can(actor, action, resource)` function and a route/action matrix covered by tests.
- IDOR tests auto-generate a request per route with a foreign resource id and assert 403/404.
- SQL is parameterized by Drizzle; raw SQL requires a comment and a reviewer.
- File uploads: signed, single-use, content-length capped, MIME validated by magic bytes, EXIF
  stripped, images re-encoded server-side before public serving.
- Rate limits: Redis token buckets keyed by IP, device, user and route class; a global circuit
  breaker per provider; queue depth metrics for the realtime service.
- PII never enters URLs, logs, traces or error messages. Chat bodies are not logged.

## 5. Secrets and infrastructure

- All secrets via environment variables validated by zod at boot (`packages/config`); processes
  exit non-zero with a precise field name when missing/malformed.
- Separate credentials per environment and per service; no shared prod/dev keys; least privilege
  (LiveKit key can only create rooms/tokens; R2 token scoped to the evidence prefix; Stripe
  restricted key for reads).
- Rotation every 90 days and immediately on suspected exposure; rotation runbook per provider;
  dual-key overlap for LiveKit and JWT signing (`kid` in header).
- Terraform state encrypted and locked; no secrets in state (referenced from the secret manager).
- Network: Postgres and Redis reachable only from app networks; Redis TLS + AUTH; R2 only via
  scoped tokens; admin behind Cloudflare Access + IP allowlist for `legal`.
- Backups: Neon PITR, nightly logical dump to encrypted object storage, restore drill quarterly.
- Dependency policy: `npm ci`, `npm audit --omit=dev --audit-level=high`, OSV scanner, Dependabot,
  `--ignore-scripts` for production installs where possible, and a two-reviewer rule for adding
  any package that runs at build time.

## 6. Detection and response

- Alerts: auth failure spikes, admin login from a new country, evidence access outside the
  console, secret scanning hits, abnormal provider spend, WAF block-rate anomaly, new device
  fingerprint cluster with high signup rate.
- Incident severities: SEV1 (evidence exposure, admin compromise, CSAM handling failure),
  SEV2 (auth bypass, payment duplication), SEV3 (degraded safety sampling).
- Every SEV1 pages security + legal + exec; a 72-hour regulator notification assessment starts at
  detection, not at confirmation.
- Post-incident review within 5 business days, blameless, with action items tracked in the risk
  register.

## 7. Pen-test checklist (pre-launch and annually)

- [ ] Auth: session fixation, JWT `aud`/`exp` bypass, token replay on a second device, logout
      invalidation, magic-link reuse, OAuth state/nonce.
- [ ] Authz: every `/admin` route and Server Action with each of the five roles; IDOR on `call_id`,
      `report_id`, `user_id`; direct R2 key access without a signature.
- [ ] Realtime: connect without JWT, with an expired JWT, with a token for another `sid`,
      event floods, 16KB+ frames, unknown fields, replay of `matched`/`skip`, cross-user `chat`.
- [ ] Matching: force a match with a blocked pair, a banned user, a `t0` guest over cap, a
      country mismatch; attempt to inject queue keys.
- [ ] Uploads: content-type confusion, polyglot image, oversized body, presigned POST reuse,
      EXIF leakage, SSRF via Cloudinary params.
- [ ] Payments: webhook signature bypass, replay, race on coin spend, negative amounts,
      entitlement escalation via client flags.
- [ ] Web: CSP bypass attempts, XSS in chat (including RTL/emoji/zero-width), CSRF on Server
      Actions, clickjacking, open redirect, cache poisoning on localized routes.
- [ ] Privacy: DSAR export completeness, deletion residue in backups/telemetry/evidence,
      cross-market data leakage.
- [ ] Infra: Redis without TLS from an app network, R2 token scope, Terraform state exposure,
      CI secrets in logs, dependency confusion.
- [ ] Abuse: bot signup at scale behind Turnstile, report brigading, ban evasion by fingerprint
      rotation.

Findings are tracked with severity, owner and SLA: critical 24h, high 7d, medium 30d. A launch
blocker is any open critical or high finding in auth, authz, evidence or payments.
