# SLOs, error budgets and alerting

A target is only real if it has a measurement, a dashboard, and a consequence when missed.
All SLIs are computed from OTel metrics or structured logs, never from a vendor dashboard alone.

## 1. Service level objectives

| # | SLI | Definition | SLO | Window | Consequence when breached |
|---|---|---|---|---|---|
| S1 | Landing performance | LCP p75, 4G throttled, real user monitoring + Lighthouse CI | < 2.0s | 7d | Block release; page frontend owner |
| S2 | Time-to-match | `matched.ts - enqueue.ts` for users who match, p95 | < 2.0s | 1h | Page realtime; freeze deploys |
| S3 | Match availability | % of enqueue attempts that match within 45s, excluding user cancel | ≥ 98% | 1d | Page realtime + product |
| S4 | Connect success | % of matched pairs with bidirectional media within 8s | ≥ 97% | 1d | Page media owner; check region |
| S5 | Signaling availability | successful authenticated connections / attempts, 1-minute buckets | ≥ 99.95% | 30d | Error budget policy (§3) |
| S6 | Signaling latency | `pong` RTT p99 same-region | < 80ms | 1h | Investigate pod/event-loop lag |
| S7 | Chat delivery | `chat` sent → delivered p99 same-region | < 250ms | 1h | Page realtime |
| S8 | Safety time-to-action | high-confidence signal → disconnect p95 | < 5s | 1d | **Page T&S + realtime** |
| S9 | Evidence completeness | reports with a complete bundle within 1h | ≥ 99.5% | 1d | Page platform |
| S10 | Moderation queue age | oldest `critical` case unacknowledged | < 15 min | continuous | Page safety lead |
| S11 | API latency | Server Action / route handler p95 (excluding streaming) | < 300ms | 1h | Investigate DB/provider |
| S12 | Error rate | 5xx / total requests | < 0.5% | 1h | Rollback if deploy-correlated |

Targets S8–S10 are safety SLOs. They outrank availability: if a choice must be made between
keeping matching up and keeping detection up, detection wins (ADR-0015).

## 2. Measurement details

- S2 excludes enqueues refused for policy reasons and users who cancel; it includes widening
  time, because that is what the user experiences.
- S4 counts 8s from `matched` to both `joined`; a LiveKit failure and a client device failure are
  separated by the client's `joined` reason so we do not blame ourselves for a broken webcam, but
  the headline number includes both.
- S5 uses connection attempts after edge admission; WAF-blocked bots are excluded and reported
  separately.
- S8 measures from the classifier response to the `ban`/`call_ended` event, not from the frame
  capture, and includes egress lag in a separate metric.
- Dashboards: `Match`, `Media`, `Safety`, `Money`, `Edge`. Each has the SLO line, the 28-day
  trend, and the top-3 contributors.

## 3. Error budget policy

- Budget = 1 − SLO over the window. For S5 (99.95%/30d) that is ~21.6 minutes of full outage.
- Burn-rate alerts: 2% of budget in 1h (fast burn) → page; 5% in 6h → ticket; 10% in 3d → review.
- When a budget is exhausted: feature work for that service pauses, deploys require an SRE
  sign-off, and the next sprint is reliability work. No exceptions without an exec decision
  recorded in `docs/reports/`.
- Safety SLOs have **no budget**. A single missed critical acknowledgement is an incident, not a
  statistic.

## 4. Alert routing

| Alert | Severity | Route |
|---|---|---|
| S8/S10 breach, critical case unacked | P1 | PagerDuty: on-call T&S + on-call platform |
| Evidence bucket unavailable / completeness < 99% | P1 | PagerDuty platform + legal on-call |
| Signaling availability burn (fast) | P1 | PagerDuty platform |
| Redis failover initiated, duplicate call detected | P1 | PagerDuty platform |
| Provider (moderation/age) outage > 5 min | P2 | Slack + PagerDuty during business hours |
| S2/S4/S7 burn | P2 | PagerDuty platform |
| Ledger drift, balance mismatch | P1 | PagerDuty payments + finance |
| Secret scanning hit, admin login from new country | P1 | Security on-call |
| Sampling degraded (tier A coverage < 95%) | P2 | T&S + platform |

Every alert has a runbook link; an alert without a runbook is deleted or gets one.

## 5. Capacity and proof

- Weekly synthetic checks in every region: enqueue → match → connect with two headless clients,
  alert if any region fails twice.
- Monthly load test in staging (10-minute k6 smoke in CI, full 50k/s proof quarterly or before a
  major matchmaking change) with results committed under `docs/reports/` including instance
  types, image digests and git SHA.
- Headroom rule: scale out at 60% sustained utilisation of any regional resource; 40% for Redis
  and LiveKit egress.
- Cost guardrails: `cost_per_1k_call_minutes` and `egress_gbps` dashboards; alert at 80% of the
  monthly budget. A cheap call is not a safe call, but an unaffordable one is not a business.

## 6. Dependencies

| Dependency | Our assumption | Detection |
|---|---|---|
| Neon | p95 commit < 20ms, 99.95% availability | OTel DB spans, Neon status, restore drill |
| Redis Cluster | p99 script < 5ms, failover < 10s | Redis metrics + synthetic |
| LiveKit | 99.9% room join, TURN reachable | join success metric, region probes |
| Moderation providers | p95 < 2s, 99.5% success | provider spans, fallback rate |
| Cloudflare R2 | 99.9% PUT/GET | upload success metric |
| Stripe | webhook delivery, no loss | reconciliation job |

A dependency breach is not an excuse: `apps/realtime` must keep matching when Postgres is down,
and the safety path must fail closed when a moderation vendor is down.
