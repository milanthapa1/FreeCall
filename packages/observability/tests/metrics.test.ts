import { describe, expect, it } from "vitest";
import {
  METRICS,
  METRIC_ATTRIBUTES,
  MetricAttributeError,
  createMeter,
  sanitizeMetricAttributes,
  type MetricDefinition,
} from "../src/metrics";

describe("METRICS catalogue", () => {
  it("uses unique, namespaced names", () => {
    const definitions = Object.values(METRICS) as MetricDefinition[];
    const names = definitions.map((definition) => definition.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name).toMatch(/^freecall\.[a-z0-9_.]+$/);
    }
  });

  it("gives every metric a unit and a description", () => {
    for (const definition of Object.values(METRICS) as MetricDefinition[]) {
      expect(definition.unit.length).toBeGreaterThan(0);
      expect(definition.description.length).toBeGreaterThan(10);
    }
  });

  it("keeps high-cardinality identifiers out of the label allowlist", () => {
    for (const forbidden of ["user_id", "call_id", "request_id", "ip", "error_message"]) {
      expect(METRIC_ATTRIBUTES as readonly string[]).not.toContain(forbidden);
    }
  });
});

describe("sanitizeMetricAttributes", () => {
  it("passes reviewed attributes through", () => {
    expect(
      sanitizeMetricAttributes({ region: "iad", outcome: "matched", cache: "hit" }),
    ).toEqual({ region: "iad", outcome: "matched", cache: "hit" });
  });

  it("rejects unbounded labels", () => {
    expect(() =>
      sanitizeMetricAttributes({ user_id: "user_123" } as unknown as never),
    ).toThrow(MetricAttributeError);
  });

  it("rejects non-finite numbers", () => {
    expect(() => sanitizeMetricAttributes({ widening_step: Number.NaN })).toThrow(
      MetricAttributeError,
    );
  });

  it("exposes the allowlist without unbounded identifiers", () => {
    expect(METRIC_ATTRIBUTES).toContain("region");
    expect(METRIC_ATTRIBUTES).not.toContain("user_id");
  });
});

describe("createMeter", () => {
  it("returns instruments even without a configured provider", () => {
    const meter = createMeter("freecall-realtime", "1.0.0");
    const counter = meter.createCounter(METRICS.wsConnectionsOpened.name);
    expect(typeof counter.add).toBe("function");
  });
});
