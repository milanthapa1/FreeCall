# ADR-0007 — Better Auth with anonymous guest sessions and in-place upgrade

- Status: accepted
- Date: 2026-10-30

## Context

The core product is one-click. Requiring an account before the first conversation kills the
funnel. But safety needs a stable subject: bans, device linkage, evidence and appeals must
attach to something that survives a page reload and, ideally, an upgrade to a real account.

## Decision

Better Auth with: Google, Apple, email magic link, and the anonymous plugin for guests.
Database sessions (not JWTs) for the web; short-lived signed JWTs (60s) minted from the session
for the realtime socket.

- A guest is a real `users` row with `is_anonymous=true`, a `sessions` row, and a device row.
  It is not a cookie-only identity.
- Guest sessions expire after 30 days of inactivity; data is deleted by the retention job.
- **Upgrade is in place**: linking a social/email identity to the guest `user_id` preserves
  bans, trust score, reports and blocks, and flips `is_anonymous` in the same transaction that
  inserts the credential. No dual-identity window.
- Account deletion (Phase 4) revokes sessions and pseudonymizes the row; evidence under legal
  hold keeps an opaque `subject_ref`, never the email.
- Cookies: `__Host-` prefix, `Secure`, `HttpOnly`, `SameSite=Lax`, signed; session rotation on
  privilege change (guest→account, tier change, ban lift). CSRF: Better Auth's origin check plus
  a double-submit token for non-Server-Action mutations.
- Device fingerprint (FingerprintJS OSS or a first-party hash of stable signals) is stored as a
  **risk signal only**, with a documented purpose, 90-day TTL, and no cross-site tracking.

## Consequences

Positive: one-click start, safety continuity, clean upgrade path, no client-side session logic.
Negative: anonymous rows inflate user counts (reporting must filter); guest abuse is cheap, so
rate limits and Turnstile carry more weight; in-place upgrade must be transactional and tested
against concurrent requests.

## Alternatives rejected

- **Cookie-only guests**: no stable subject for bans; trivially reset; evidence would be orphaned.
- **Auth.js/NextAuth**: fewer built-in primitives for anonymous sessions and org/RBAC; we would
  reimplement session storage anyway.
- **Clerk/Auth0**: cost at 1M MAU and data-residency friction.

## Revisit trigger

Better Auth cannot express a required primitive (e.g. passkeys with attestation policy), or
session lookup becomes a measurable share of web p95.
