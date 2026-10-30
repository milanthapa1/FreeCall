# ADR-0015 — Safety actions fail closed, with a single policy engine and full provenance

- Status: accepted
- Date: 2026-10-30

## Context

Moderation systems drift into fail-open behaviour: a vendor times out, so the frame is dropped;
a threshold is tuned to reduce false positives, so a real violation passes; an automated ban is
reversed by support without a record. Each of those is defensible in isolation and indefensible
in aggregate.

## Decision

1. **One policy engine** (`packages/core/safety`): every detection — visual, text, report,
   heuristic — produces a `Signal {source, label, score, model, model_version}`. A versioned
   policy maps `Signal[] → Action[]` (`disconnect`, `lock`, `shadow`, `strike`, `ban`,
   `escalate_human`, `preserve_evidence`). No component outside the engine disconnects, bans or
   locks anyone. Policies are code + config, versioned, and their version is stored on every
   action.
2. **Fail closed on uncertainty, fail open on availability**: if the high-severity path
   (minors-risk, CSAM hash, weapons with credible threat) cannot be evaluated because providers
   are down, the affected session is ended with `review_required` and queued; the user is not
   silently permitted to continue. Low-severity sampling may degrade with a metric and alert.
3. **Provenance is mandatory**: every action row carries signal ids, scores, thresholds, model
   versions, policy version, actor (system or human), and the evidence manifest hash. An action
   without provenance is a bug that fails the test suite.
4. **Irreversible actions require corroboration or a human**: permanent bans from client
   (advisory) frames alone are forbidden; permanent bans from server frames require two
   independent signals or a senior reviewer. Reports alone never permanently ban a first-time
   account.
5. **Reversibility**: every automated action can be appealed; appeals are first-class records
   with SLA, outcome, reviewer and reason. Reversals are compensating records, not deletions.
6. **Human review is not optional at the top end**: a `critical` case pages on-call and must be
   acknowledged within 15 minutes, 24/7.
7. **No silent threshold changes**: any change to a threshold or policy version requires a
   regression run over the labelled corpus and is recorded in `audit_logs`.

## Consequences

Positive: auditable, consistent, appealable, and defensible to regulators; behaviour is
testable in isolation from providers. Negative: more latency on the high-severity path
(acceptable: seconds vs a permanent harm), and tuning becomes a governed process rather than a
quick config change.

## Alternatives rejected

- **Per-feature moderation logic**: inconsistent actions and no single place to audit.
- **Fail open everywhere for availability**: contradicts the product's core promise.
- **Fully manual moderation**: cannot scale to 1M CCU and exposes humans to more harmful content.

## Revisit trigger

A regulator requires a specific decision standard (e.g. "manifestly illegal" test) that the
policy engine cannot express, or an action class emerges that cannot be reversed.
