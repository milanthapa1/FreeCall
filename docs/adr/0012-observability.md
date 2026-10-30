# ADR-0012 — Privacy-safe observability (OTel + Sentry + PostHog)

- Status: accepted
- Date: 2026-10-30

## Context

We need to debug a 1M-connection realtime system and prove safety SLAs, while the product
handles sensitive video, reports and age data. Telemetry is a common source of accidental PII
and special-category data leakage.

## Decision

- **OpenTelemetry** for traces and metrics from every runtime, OTLP to a collector that runs in
  our infrastructure, then to the vendor. Trace context propagates web → realtime → worker via
  `traceparent` in the socket `hello` and in job payloads.
- **Naming**: `freecall.<domain>.<subject>` for metrics (`freecall.match.pop_ms`,
  `freecall.safety.time_to_action_ms`). Span attributes are allowlisted per domain.
- **Redaction is structural, not best-effort**: the logger accepts only `LogFields` from a
  typed allowlist. `userId` is logged as a hashed ID (`u_<sha256(user_id)[:16]>`) outside the
  safety domain; chat text, frame URLs, emails, IPs, user agents, tokens and provider payloads
  are rejected at the type level. IPs are kept only as a coarse `/24` or country at the edge
  metric layer for abuse detection, never in traces.
- **Sentry**: errors only, with `beforeSend` scrubbing and `sendDefaultPii: false`. Source maps
  uploaded with release; no request bodies, no cookies.
- **PostHog**: consent-gated (analytics category), EU or US region per market, no autocapture of
  form inputs, no session replay at launch (replay on a video chat product is a privacy
  landmine). Product events are named enums, not free text.
- **Audit vs telemetry**: `audit_logs` is the authoritative record for enforcement actions;
  telemetry is for operations. The console reads audit logs, never traces.
- **Dashboards-as-code**: Grafana JSON committed in `infra/observability`; alerts in
  `docs/slo.md`. Sampling: 100% of safety spans, 1% of chat spans, tail-sampled at the collector
  for errors and slow matches.

## Consequences

Positive: debuggable without hoarding personal data; evidence lives only in the evidence store;
data-subject requests are tractable because telemetry holds no direct identifiers. Negative:
some bugs are harder to reproduce without payloads (mitigated by correlation ids and by
replaying anonymized fixtures); collector is another component to operate.

## Alternatives rejected

- **Vendor SDKs directly from apps**: no central redaction point, inconsistent schemas.
- **Full session replay**: unacceptable for a video product.
- **No tracing**: we cannot meet the p95 TTM SLO without per-stage spans.

## Revisit trigger

A privacy regulator or DPA requires telemetry data residency per market, or a vendor changes
default PII handling.
