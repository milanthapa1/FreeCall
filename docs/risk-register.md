# Risk register

Scoring: likelihood (1–5) × impact (1–5). Review monthly; any change to a score ≥ 15 is
reported to the safety lead and the exec owner. "Residual" is the score after the listed
mitigations are actually implemented — not after they are planned.

## A. User-harm and legal risk (highest priority)

| ID | Risk | L | I | Score | Mitigations | Detection | Owner | Residual |
|---|---|---|---|---|---|---|---|---|
| R01 | Minor reaches video matching via self-declared guest tier | 4 | 5 | 20 | Server-side age gate; guest tier capped (30 min/day, no DMs/uploads); tiered sampling on `t0`; device/IP risk signals; rapid re-assurance prompts on suspicion | Age-assurance funnel metrics; moderator case tagging; reports mentioning minors | T&S lead | 8 |
| R02 | CSAM produced or shared on the platform | 2 | 5 | 10 | Hash matching (provider/ISPP) on frames + uploads; immediate disconnect/lock/preserve; NCMEC ESP reporting workflow; no in-product viewing; two-person break-glass; staff training | CSAM adapter hit rate; provider reports; e2e of mock path | Legal + T&S | 6 |
| R03 | Non-consensual intimate imagery (NCII) recorded by a partner | 4 | 5 | 20 | No recording features; screen-recording detection signal; report flow preserves evidence; fast ban + device block; deterrence copy; DMCA/NCII takedown path | Reports with `ncii` reason; classifier `screen_recording` label | T&S | 12 |
| R04 | Adult content shown to a user who did not consent (flashing) | 4 | 4 | 16 | Nudity classifier on sampled frames; instant disconnect on high confidence; repeat-offender escalation; report one-tap | Time-to-action metric; nudity label rate | T&S | 8 |
| R05 | Harassment/threats in chat or on camera | 4 | 4 | 16 | Text moderation pre-persist; link/contact blocking; per-partner spam detection; block list; report with 50-message context | Report rate per 1k calls; blocked-pair rate | T&S | 8 |
| R06 | Age-assurance vendor false negative/positive | 3 | 4 | 12 | Two providers wired; quarterly accuracy audit on 18–20 boundary; human review of appeals; conservative thresholds in high-risk markets | Vendor decision distribution vs. outcomes; appeal overturns | Product + Legal | 8 |
| R07 | Moderator psychological harm from exposure | 4 | 4 | 16 | Blur by default; click-to-reveal; no autoplay; break reminders; rotation limits; EAP access; exposure-incident runbook | Wellness survey; session length metrics; incident reports | Head of T&S | 8 |
| R08 | Unlawful retention or disclosure of evidence | 3 | 5 | 15 | Bucket policy lifecycle; legal hold segregation; DSAR workflow that excludes held evidence with documented basis; access audit | Nightly orphan check; quarterly privacy audit | DPO | 6 |
| R09 | Regulatory action for insufficient age assurance in a market | 3 | 5 | 15 | Per-market `required_tier`; launch toggles; documented risk acceptance where self-declaration is permitted; legal review per market | Regulatory monitoring; market policy review cadence | Legal | 9 |
| R10 | Law-enforcement request handled incorrectly (over/under-disclosure) | 3 | 4 | 12 | Written request-handling policy; legal-only workflow; preservation (not disclosure) first; log every request | Request log review | Legal | 6 |

## B. Product and abuse risk

| ID | Risk | L | I | Score | Mitigations | Detection | Owner | Residual |
|---|---|---|---|---|---|---|---|---|
| R11 | Botnets farm guest sessions for spam/scam links | 4 | 3 | 12 | Turnstile; per-IP/device limits; device reputation; text link blocking; trust-weighted reports; progressive challenge | Signup-per-IP distribution; message block-rate anomaly | Platform | 6 |
| R12 | Report brigading to ban innocent users | 3 | 4 | 12 | Reporter trust weighting; distinct-report requirement; corroboration rule; appeals with human review; per-reporter accuracy tracking | Ban reversal rate by reporter cluster | T&S | 6 |
| R13 | False positives alienate good users | 4 | 3 | 12 | Shadow-flag before ban; corroboration for permanent bans; appeals SLA; threshold regression tests before changes | FP rate in weekly report; appeal overturn rate | T&S | 6 |
| R14 | Nudity/abuse classifier provider outage | 3 | 4 | 12 | Secondary provider; fail-closed `review_required` for elevated risk; degraded-mode banner in console; sampling debt metric | Provider error rate; `sampling_degraded_total` | Platform | 6 |
| R15 | Queue starvation in small markets (no matches) | 4 | 3 | 12 | Widening (language at 5s, region at 10s); cross-region borrow with RTT cap; honest empty-state copy; launch toggles | p95 TTM by market; enqueue-abandon rate | Product | 6 |
| R16 | LiveKit/egress cost overruns margin | 4 | 4 | 16 | 480p default; simulcast off; tiered sampling; per-region capacity caps; cost per call-minute dashboard with alert | Cost per 1k call-minutes; egress minutes | Platform + Finance | 10 |

## C. Technical and operational risk

| ID | Risk | L | I | Score | Mitigations | Detection | Owner | Residual |
|---|---|---|---|---|---|---|---|---|
| R17 | Redis failover loses queue state or double-pairs | 3 | 4 | 12 | Ephemeral queues with explicit `requeue_required`; idempotent `call_id` creation; chaos test in CI-nighly; runbook | Duplicate-call detector; failover drill results | Platform | 6 |
| R18 | Deploy drops live sockets | 4 | 3 | 12 | 120s drain; surge-first rolling; client reconnect-with-resume; deploy freeze during incidents | Dropped-session counter during deploys | Platform | 4 |
| R19 | Secret leak (LiveKit/Stripe/provider keys) | 3 | 5 | 15 | Env-only secrets; zod boot validation; no secrets in client bundles (CI check); 90-day rotation; GitHub secret scanning; least-privilege keys per environment | Secret scanning alerts; anomalous provider usage | Security | 6 |
| R20 | Supply-chain compromise (npm dependency) | 4 | 4 | 16 | Lockfile; `npm ci`; Dependabot + OSV; provenance/`npm audit signatures`; no postinstall scripts in production deps; review policy for new deps | SCA alerts; unusual outbound traffic | Security | 8 |
| R21 | Protocol drift between web and realtime | 3 | 3 | 9 | Single zod package; contract tests; breaking-change detector; `v`/`v-1` window | CI failure; `protocol_error` rate | Platform | 3 |
| R22 | Postgres primary outage | 2 | 5 | 10 | Neon HA; matching independent of DB; bounded write retry; read-only degraded mode; restore drill quarterly | Availability SLO; replication lag | Platform | 5 |
| R23 | Evidence upload silently lost after a report | 3 | 4 | 12 | `evidence_pending` state; 24h retry; alert if case open > 1h without evidence; client retry with idempotency key | Evidence completeness metric | Platform | 4 |

## D. Business and compliance risk

| ID | Risk | L | I | Score | Mitigations | Detection | Owner | Residual |
|---|---|---|---|---|---|---|---|---|
| R24 | Payment fraud / chargeback abuse of coins | 4 | 3 | 12 | Stripe Radar; velocity limits; coin spend requires non-guest tier; chargeback revocation; no cash-out | Chargeback rate; coin velocity anomalies | Finance | 6 |
| R25 | GDPR/CCPA DSAR missed deadline | 3 | 4 | 12 | Export/delete jobs with SLA timers; evidence-hold exception documented; quarterly drill | DSAR queue age; drill results | DPO | 4 |
| R26 | Data residency violation (EU data in US) | 3 | 4 | 12 | Region-pinned DB/bucket per market where required; telemetry region; vendor DPAs; document flows | Data-flow review; vendor audits | DPO + Platform | 8 |
| R27 | Brand/domain squatting or impersonation before launch | 3 | 3 | 9 | Register domains + handles early (blocked: brand name); monitoring; takedown playbook | Brand monitoring | Marketing | 6 |
| R28 | Key-person dependency on realtime design | 4 | 4 | 16 | ADRs; runbooks; simulator reproducible by any engineer; pairing on the matcher; on-call rotation from Phase 2 | Bus-factor review | Eng lead | 8 |

## Top five to watch weekly

1. **R01** minors on platform — the one risk that can end the company.
2. **R03/R04** NCII and flashing — the most common severe user harm.
3. **R02** CSAM handling — process failures here are criminal, not civil.
4. **R16** egress cost — the model works only if cost per call-minute stays under target.
5. **R20** supply chain — a single compromised package owns the admin console.

## Accepted risks (documented, owner signed)

- Queue position is lost on Redis failover (R17 residual). Accepted: users retry, calls unaffected.
- Full server-side frame sampling is not economically viable (ADR-0008). Accepted: client frames
  are advisory and cannot alone cause a permanent ban.
- Cross-region matching is off by default, so very small markets may see longer queues (R15).
  Accepted until launch data justifies borrowing.
