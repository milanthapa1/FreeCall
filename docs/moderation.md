# Safety and moderation

Safety is a product surface with its own SLOs, not a filter bolted onto chat. This document
defines what is detected, what happens, who decides, and what is recorded.

## 1. Principles

1. **Protect first, review second.** High-confidence severe harm ends the session immediately;
   human review follows.
2. **Fail closed on severe uncertainty.** If the severe path cannot be evaluated, the session
   ends with `review_required` rather than continuing.
3. **One policy engine** (`packages/core/safety`, ADR-0015). Providers emit signals; the policy
   engine decides. Nothing else disconnects, bans or locks.
4. **Provenance or it did not happen.** Every action stores model, version, score, threshold,
   policy version, evidence hash, actor.
5. **No one is asked to look at CSAM.** Hash match + metadata only; the material is quarantined
   and reported, never displayed in-product.
6. **Minimum data.** Frames exist only when needed, for as long as needed.

## 2. Label taxonomy and thresholds

Normalized labels (`packages/moderation/taxonomy.ts`), mapped from each vendor's vocabulary:

| Label | Meaning | Auto-disconnect | Lock | Shadow / resample | Notes |
|---|---|---|---|---|---|
| `sexual_explicit` | visible genitalia or explicit sexual act | score ≥ 0.90 (+ second frame ≥ 0.75) | — | 0.60–0.89 | Single-frame high score from server egress may act alone |
| `sexual_suggestive` | nudity-adjacent, lingerie, exposed chest | — | — | ≥ 0.70 | Not an offence; drives resampling and a warning nudge |
| `minor_presence` | a person assessed under 18 | ≥ 0.80 (server) / ≥ 0.92 (client) | yes | 0.55–0.79 | **Critical.** Lock + preserve + escalate |
| `csam_hash_match` | provider hash match | immediate | yes | — | Critical; NCMEC workflow, §4 |
| `violence_graphic` | blood, injury, animal cruelty | ≥ 0.90 | — | 0.70–0.89 | |
| `weapon` | firearm or bladed weapon visible | ≥ 0.95 and credible context | — | ≥ 0.80 | Context matters; single frame rarely sufficient |
| `screen_recording` | overlay UI of a recorder/screenshot tool | — | — | ≥ 0.75 | Raises sampling tier; report prompt |
| `text_overlay_abuse` | slurs/contact info burned into video | — | — | ≥ 0.70 | Cross-checked with text rules |
| `self_harm` | visible self-injury | — | — | ≥ 0.75 | Human review + resource surface, never punitive by default |

Thresholds are **per market** (`market_policies`) and per source (`server` vs `client`), stored
in config with a policy version. Client frames need a higher bar because they are advisory
(ADR-0008). Every threshold change requires a regression run over the labelled corpus and is
audited.

## 3. Pipeline

```
capture ──► normalize ──► classify ──► signals ──► policy engine ──► action ──► audit + metrics
  │                          │                         │
  │                          └─ provider A→B fallback  └─ human queue (severity)
  └─ frame: server egress (tier A/C/D) or client canvas (tier B, advisory)
```

| Stage | Budget | Failure behaviour |
|---|---|---|
| Capture (client) | ≤ 150ms every 5s | Skip frame, count `frame_capture_missed`; 3 misses → warning UI |
| Capture (server egress) | ≤ 1s per sample | Retry once; then `sampling_degraded_total` + alert |
| Upload (client) | ≤ 3s p95 | Drop frame; never block the call |
| Classify | ≤ 2s p95 | Provider B; both down → §3.1 |
| Policy evaluate | ≤ 20ms | Local, no I/O |
| Enforce disconnect | ≤ 5s from signal | Worker + realtime; idempotent on `call_id` |
| Case creation | ≤ 10s p95 | Retry with backoff; `evidence_pending` state |

### 3.1 Provider outage

- `minor_presence` and `csam_hash_match` are **mandatory** checks on tier A/D traffic. If no
  provider can evaluate them, the room is ended with `end_reason=review_required` and the case
  is queued; the users are told "connection ended for a safety check" and can start a new call.
- Low-severity labels may degrade: frames are queued to a durable backlog for later scoring, the
  console shows a `sampling_degraded` banner, and the on-call is paged after 5 minutes.

### 3.2 Text

Normalization before classification: Unicode NFKC, homoglyph folding, leetspeak map, spacing and
repetition collapse, zero-width removal, emoji-sequence expansion for known coded contact
patterns. Then:

- vendor moderation (OpenAI) + deterministic rules (links, `@handles`, phone patterns, invite
  codes, crypto addresses, "add me on …"), each with its own signal and score;
- duplicate-message detection across partners (shingled hashes in a 10-minute window) to catch
  spam scripts;
- contact-sharing is blocked outright in in-call chat; DMs (Phase 4) allow a limited, consent-
  based flow and are always moderated before persist;
- the classifier never sees the raw body after it is blocked; a blocked body is hashed into the
  case, not stored in cleartext beyond the 7-day moderation log.

## 4. CSAM and minors-risk: incident workflow

This is the procedure the platform is judged on. It is rehearsed quarterly and exercised in e2e
with synthetic hashes only.

**Detection (automated, t+0)**

1. Hash match or `minor_presence` above the auto-action threshold.
2. Realtime immediately: ends the call (`end_reason=enforcement`), locks the subject
   (`users.status='locked'`, all sessions revoked), blocks enqueue, and emits a `ban` event.
3. Worker writes an evidence bundle to the **restricted** prefix (`evidence/restricted/…`) with
   bucket object lock and legal hold, plus a manifest hash in Postgres. The raw object is never
   served by any route.
4. Case created with `severity='critical'`, `status='escalated'`, assigned to the on-call
   safety lead. PagerDuty high-urgency page; acknowledgement SLA 15 minutes, 24/7.

**Human review (t+15 min)**

5. A **senior reviewer** sees only: hash metadata, provider confidence, model/version, market,
   account age, device/IP risk summary, and the chat evidence. They do **not** open the media.
6. The reviewer confirms or rejects the match. A confirm moves the case to the legal workflow; a
   reject unlocks the account, records the false positive, and files a model-feedback record.

**Reporting (t+1h, legal)**

7. Legal (or the designated ESP point of contact) files a report with NCMEC's CyberTipline via
   the provider/ESP channel, including the required subscriber/account information, the
   incident time, and the preserved file identifiers. Where the market requires reporting to a
   national authority instead of or in addition to NCMEC, the market policy pack names it.
8. Preserved material is retained per 18 U.S.C. § 2258A(h)-style preservation duties (minimum 90
   days, longer on request) and **is never copied outside the restricted bucket**. No employee
   downloads it.
9. Law-enforcement requests go to Legal only; the response is limited to what the request
   compels, logged in `legal_requests`, and preservation is started before any disclosure.

**Aftercare**

10. The account stays locked. An appeal is possible but does not unlock the media path; appeals
    for a confirmed CSAM case are decided by Legal, not moderators.
11. Post-incident review within 5 business days: detection path, time-to-action, whether any
    other session involved the subject, and model feedback. Metrics land in the weekly report.

**Hard rules**

- No moderator, support agent, or engineer may view suspected CSAM. The product has no viewer
  for it.
- Break-glass access requires two approvers, is limited to legal, and is itself reported to the
  DPO.
- If real CSAM is ever encountered outside the automated path (e.g. a test fixture), stop,
  do not copy, notify Legal and Security immediately, and follow the exposure runbook.

## 5. Reports, blocks and cases

- Report is one tap, works when media is frozen, and requires no account.
- The client captures the partner frame it is currently rendering and the last 50 messages from
  the server's ring buffer (the client's copy is a cross-check). The server verifies that both
  parties were in the call.
- Evidence upload is presigned, single-use, 2-minute TTL, 256KB cap, MIME-checked by magic bytes.
- `unique (call_id, reporter_id)` makes retries idempotent.
- Blocking is immediate (Redis exclusion write before the HTTP response returns), persistent, and
  symmetric for matching purposes.
- Case states: `open → evidence_pending → in_review → actioned | dismissed | escalated`.
  Dismissal requires a reason code; action requires a reason code and a policy reference.

## 6. Auto-ban engine

Inputs: report signals (weighted), automated detection signals, human decisions, history.

**Reporter weight** = `0.2 + 0.8 × accuracy`, where accuracy is the share of that reporter's last
20 reports that were actioned (smoothed with a Beta prior so new reporters start at 0.5).
Banned or `low`-band reporters count 0.

**Score** for a subject over a 24h window: `Σ weight(report) + 1.5 × Σ high-severity
auto-signals`, capped at 10. Tiers:

| Score | Action | Duration |
|---|---|---|
| ≥ 3.0 with ≥ 3 distinct reporters | temporary ban (`platform`) | 24h |
| second temporary ban in 30 days | permanent ban | — |
| one confirmed high-severity auto-signal (server-proven) | temporary ban | 7d |
| `critical` (minor/CSAM) | immediate lock | permanent, legal path |
| 2+ upheld reports of `spam`/`scam` | `dm` + `upload` scope ban | 30d |

Rules: the engine is idempotent per `(subject, window, policy_version)`, never bans on a single
client frame, and writes the full signal set to the ban row's `evidence_case_id`. Every ban is
appealable; appeals are decided by a human within 72h (SLO), and the decision is stored with the
reviewer id.

Evasion: device fingerprint and IP reputation raise risk and can force re-assurance, but a
fingerprint alone never bans. A banned device opening a guest session is blocked at enqueue when
the confidence is high, and flagged for review otherwise. Measured target: ≥ 95% of seeded
evasion cases blocked.

## 7. Moderator console (`/admin`)

- **Queue**: cases sorted by severity then age, with SLA countdown. Filters by reason, market,
  model label, reporter weight, and `evidence_pending`.
- **Case view**: blurred media by default; click-to-reveal per item, 5-minute window, reason
  required; chat transcript; signal table with scores and model versions; subject history
  (reports, bans, appeals; never age documents); call metadata.
- **Actions**: dismiss (reason), warn, temporary ban (duration + reason), permanent ban (reason +
  corroboration), escalate to legal, request re-review. All require a reason code; ban actions
  require typing the case id to prevent misfires.
- **RBAC**: `moderator` (case actions), `senior_reviewer` (reveal + permanent bans),
  `legal` (restricted prefix, law-enforcement workflow), `auditor` (read-only), `admin`
  (config, no case powers). Enforced server-side on every action (ADR-0016).
- **Wellness**: blurred by default, no autoplay, break reminder after 45 minutes of case
  activity, hard block on restricted material, exposure-incident button, access to EAP.
- **Shift stats**: cases/hour, time-to-first-action, backlog, appeal overturns, per-moderator
  agreement rate (sample re-review), all from `audit_logs`/`reports`.
- **Audit**: every view of unblurred media, every action, every filter export is logged with
  actor, case, timestamp, reason and request id.

## 8. Weekly safety report (automated)

Generated by the worker every Monday 06:00 UTC, stored in the console and emailed to T&S, Legal
and the exec owner:

- volume: calls, reports per 1k calls, unique reporters, cases by reason/severity/market;
- model quality: per-label precision/recall on human-reviewed samples, FP rate, drift vs last
  week, sampling coverage %;
- speed: time-to-action p50/p95 (detection → disconnect, report → first action), evidence
  completeness, queue age;
- outcomes: bans by type, appeals, overturn rate, recidivism (re-banned within 30/90 days),
  evasion blocks;
- incidents: critical cases, CSAM reports filed, law-enforcement requests, exposures.

Thresholds for escalation to the safety lead: FP rate > 5% on any high-severity label,
time-to-action p95 > 60s, evidence completeness < 99%, or any critical case unacknowledged for
> 15 minutes.
