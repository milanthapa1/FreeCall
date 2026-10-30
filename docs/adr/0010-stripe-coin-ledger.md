# ADR-0010 — Stripe + append-only coin ledger with idempotency keys

- Status: accepted
- Date: 2026-10-30

## Context

Monetization (Phase 5) is coins and subscriptions. Coin balances are the classic place where a
retried webhook, a double-clicked purchase, or a concurrent spend silently creates money or
steals it. Stripe retries webhooks for up to three days and can deliver duplicates.

## Decision

- **Stripe** for payments: Checkout for coin packs, Billing for subscriptions, Customer Portal
  for self-serve. Webhooks verified with the signing secret; the raw body is captured before
  parsing.
- **Append-only ledger**: `coin_ledger(id, user_id, delta, reason, ref_type, ref_id,
  idempotency_key unique, created_at)`. Balance is derived (`SUM(delta)`) and also cached in
  `users.coin_balance` updated in the same transaction with a `SELECT ... FOR UPDATE` on the
  user row. A nightly job asserts `cache = SUM(delta)` and alerts on drift.
- **Idempotency**: every mutation carries a deterministic key —
  `stripe:{event_id}` for webhooks, `spend:{call_id}:{purpose}` for consumption,
  `daily:{user_id}:{utc_date}` for grants. Unique index makes replay a no-op; the handler returns
  200 on conflict.
- **Webhook processing**: `stripe_events` dedupe table, insert-then-process inside one
  transaction, 5xx only for retryable failures (DB down), 2xx for everything we understood,
  including "unknown event type" after logging.
- **Subscriptions** map to entitlements (`priority_matching`, `hd`, `ad_free`, `extra_filters`)
  resolved server-side per request; the client never asserts an entitlement.
- **Refunds and chargebacks**: compensating ledger entries, never deletes; a chargeback revokes
  entitlements and may suspend monetization eligibility, never the safety-relevant account state.
- **Tax/legal**: prices and availability per market come from config; Stripe Tax enabled where
  available. No card data touches our systems.

## Consequences

Positive: replay-safe, auditable, and reconcilable; the balance cache is an optimization, never
the source of truth. Negative: every new money feature must define an idempotency key and a
reason code — enforced by a lint rule and a test template; the ledger grows forever (partitioned
monthly, archived to R2 after 24 months).

## Alternatives rejected

- **Mutable balance column only**: cannot answer "why is this balance 40?" in an appeal or audit.
- **Double-entry accounting system**: correct but overkill until there is a payout surface;
  the append-only ledger is convertible later.
- **Third-party entitlements service**: adds a vendor in the critical path of paid features.

## Revisit trigger

Marketplace payouts, multi-currency wallets, or a requirement to settle with creators.
