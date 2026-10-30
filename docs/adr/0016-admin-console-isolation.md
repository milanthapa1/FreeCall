# ADR-0016 — Admin console inside web, isolated route group, server-enforced RBAC

- Status: accepted
- Date: 2026-10-30

## Context

Moderators need a console at `/admin`. Options: a separate app/deployment, or a route group in
the Next.js app. A separate app gives the strongest isolation but doubles the auth, design
system and deploy surface for a small team, and moderators need the same case models as the rest
of the product.

## Decision

The console is a route group `(admin)` inside `apps/web`, with isolation enforced in depth:

- Separate session audience: a moderator session is a distinct Better Auth session with
  `audience=admin`, MFA required (TOTP), and a 8-hour absolute lifetime with 30-minute idle
  timeout. Normal product sessions cannot access any admin route, and admin sessions cannot be
  used for product actions.
- RBAC: `moderator`, `senior_reviewer`, `legal`, `auditor` (read-only), `admin` (config, no case
  powers by default). Permission checks live in `packages/core/authz` and are called **inside**
  every Server Action and route handler; the UI only hides what the server would refuse anyway.
- Network: `/admin` behind Cloudflare Access (SSO + device posture) at the edge, plus an IP
  allowlist for the `legal` role. No public anonymous reachability.
- Data: the console never receives raw evidence URLs. It receives derivatives through a proxy
  route that checks permission, mints a 60s signed URL, and logs the access. Blur-by-default,
  reveal is per item and time-boxed.
- Separate CSP, no analytics, no PostHog, no third-party scripts on admin routes.
- Every mutation is a Server Action with CSRF/origin checks, an explicit `reason_code`, and an
  `audit_logs` write in the same transaction as the effect.
- Deployment: same artifact at launch. The route group is behind a feature flag and can be split
  into its own deployment without changing the page code if the threat model demands it.

## Consequences

Positive: fast to build, one design system, shared types, still strongly isolated at the session
and network layers. Negative: a web-app RCE or dependency compromise reaches the console (hence
edge Access + separate session + no third-party scripts); the split path must stay viable
(no console-only dependencies in shared code).

## Alternatives rejected

- **Separate Next.js app at launch**: real isolation, but triples boilerplate for a 6-person team
  and would delay Phase 3, where the console is a safety requirement.
- **Third-party moderation console (e.g. vendor dashboard)**: no access to our trust graph,
  appeal state or audit trail; vendors are processors.

## Revisit trigger

The console gains legal-hold or CSAM-review powers, or a pen test finds cross-tenant risk in the
shared app. Then split it into `apps/admin` with its own deployment and network boundary.
