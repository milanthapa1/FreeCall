import { metrics, type Meter } from "@opentelemetry/api";

/**
 * Metric catalogue. Names and units are fixed here so dashboards and alerts do not drift
 * between services, and so a metric cannot be created ad hoc with an unbounded label.
 *
 * Naming convention: `freecall.<domain>.<thing>`.
 * - counters end in `_total`
 * - histograms end in `_ms` or `_bytes`
 * - up/down counters end in `_active` or `_depth`
 */

export type MetricKind = "counter" | "histogram" | "up_down_counter";

export interface MetricDefinition {
  readonly name: string;
  readonly kind: MetricKind;
  readonly unit: string;
  readonly description: string;
}

export const METRICS = {
  wsConnectionsOpened: {
    name: "freecall.ws.connections.opened_total",
    kind: "counter",
    unit: "{connection}",
    description: "WebSocket connections accepted",
  },
  wsConnectionsClosed: {
    name: "freecall.ws.connections.closed_total",
    kind: "counter",
    unit: "{connection}",
    description: "WebSocket connections closed, by close code",
  },
  wsConnectionsActive: {
    name: "freecall.ws.connections.active",
    kind: "up_down_counter",
    unit: "{connection}",
    description: "Currently open WebSocket connections",
  },
  wsMessagesReceived: {
    name: "freecall.ws.messages.received_total",
    kind: "counter",
    unit: "{message}",
    description: "Client messages received, by event type",
  },
  wsMessagesRejected: {
    name: "freecall.ws.messages.rejected_total",
    kind: "counter",
    unit: "{message}",
    description: "Client messages rejected as invalid or rate limited",
  },
  matchingQueueDepth: {
    name: "freecall.matching.queue.depth",
    kind: "up_down_counter",
    unit: "{user}",
    description: "Users currently waiting to be matched",
  },
  matchingWaitMs: {
    name: "freecall.matching.wait_ms",
    kind: "histogram",
    unit: "ms",
    description: "Time from enqueue to match, by widening step",
  },
  matchingMatchesTotal: {
    name: "freecall.matching.matches_total",
    kind: "counter",
    unit: "{match}",
    description: "Successful matches created",
  },
  callDurationMs: {
    name: "freecall.call.duration_ms",
    kind: "histogram",
    unit: "ms",
    description: "Connected call duration",
  },
  callSetupFailuresTotal: {
    name: "freecall.call.setup_failures_total",
    kind: "counter",
    unit: "{failure}",
    description: "Calls that failed before media connected",
  },
  moderationEvaluationsTotal: {
    name: "freecall.moderation.evaluations_total",
    kind: "counter",
    unit: "{evaluation}",
    description: "Moderation provider evaluations, by provider and outcome",
  },
  moderationLatencyMs: {
    name: "freecall.moderation.latency_ms",
    kind: "histogram",
    unit: "ms",
    description: "Round-trip latency to a moderation provider",
  },
  moderationActionsTotal: {
    name: "freecall.moderation.actions_total",
    kind: "counter",
    unit: "{action}",
    description: "Enforcement actions taken, by action and reason",
  },
  safetyReportsTotal: {
    name: "freecall.safety.reports_total",
    kind: "counter",
    unit: "{report}",
    description: "User reports received, by reason and severity",
  },
  safetyBanChecksTotal: {
    name: "freecall.safety.ban_checks_total",
    kind: "counter",
    unit: "{check}",
    description: "Ban lookups, by cache hit or source",
  },
  redisCommandLatencyMs: {
    name: "freecall.redis.command_latency_ms",
    kind: "histogram",
    unit: "ms",
    description: "Redis command latency",
  },
  dbQueryLatencyMs: {
    name: "freecall.db.query_latency_ms",
    kind: "histogram",
    unit: "ms",
    description: "Postgres query latency",
  },
  httpRequestDurationMs: {
    name: "freecall.http.request_duration_ms",
    kind: "histogram",
    unit: "ms",
    description: "HTTP request duration",
  },
  httpRequestsTotal: {
    name: "freecall.http.requests_total",
    kind: "counter",
    unit: "{request}",
    description: "HTTP requests, by route and status class",
  },
  evidenceUploadBytes: {
    name: "freecall.evidence.upload_bytes",
    kind: "histogram",
    unit: "bytes",
    description: "Size of evidence objects written",
  },
} as const satisfies Record<string, MetricDefinition>;

export type MetricKey = keyof typeof METRICS;
export type MetricName = (typeof METRICS)[MetricKey]["name"];

/**
 * Reviewed metric labels. Ever-growing values (user ids, call ids, raw IPs, error
 * messages) must never be labels: one label per user destroys the time series database.
 */
export const METRIC_ATTRIBUTES = [
  "region",
  "market",
  "mode",
  "action",
  "outcome",
  "reason_code",
  "provider",
  "model",
  "status_class",
  "widening_step",
  "close_code",
  "cache",
] as const;

export type MetricAttribute = (typeof METRIC_ATTRIBUTES)[number];
export type MetricAttributeValue = string | number | boolean;
export type MetricAttributes = Partial<Record<MetricAttribute, MetricAttributeValue>>;

const METRIC_ATTRIBUTE_SET: ReadonlySet<string> = new Set(METRIC_ATTRIBUTES);

export class MetricAttributeError extends Error {
  readonly attribute: string;

  constructor(attribute: string) {
    super(
      `Metric attribute "${attribute}" is not on the reviewed label allowlist. High-cardinality labels break dashboards and cost money; use a log field instead.`,
    );
    this.name = "MetricAttributeError";
    this.attribute = attribute;
  }
}

export function sanitizeMetricAttributes(attributes: MetricAttributes): MetricAttributes {
  const safe: MetricAttributes = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (!METRIC_ATTRIBUTE_SET.has(key)) throw new MetricAttributeError(key);
    if (value === undefined) continue;
    if (
      typeof value === "string" ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))
    ) {
      safe[key as MetricAttribute] = value;
    } else {
      throw new MetricAttributeError(key);
    }
  }
  return safe;
}

/** Creates a meter for a service. Instruments should be created once at boot and reused. */
export function createMeter(serviceName: string, serviceVersion = "0.0.0"): Meter {
  return metrics.getMeter(serviceName, serviceVersion);
}
