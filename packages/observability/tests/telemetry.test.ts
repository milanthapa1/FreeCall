import { describe, expect, it } from "vitest";
import {
  TelemetryConfigError,
  assertSampleRate,
  normalizeOtlpTracesUrl,
  startTelemetry,
} from "../src/telemetry";

describe("normalizeOtlpTracesUrl", () => {
  it("appends the signal path to a bare collector URL", () => {
    expect(normalizeOtlpTracesUrl("https://otel.example.com", "production")).toBe(
      "https://otel.example.com/v1/traces",
    );
  });

  it("is idempotent for a full traces URL", () => {
    expect(normalizeOtlpTracesUrl("https://otel.example.com/v1/traces", "production")).toBe(
      "https://otel.example.com/v1/traces",
    );
    expect(normalizeOtlpTracesUrl("https://otel.example.com/v1/traces/", "production")).toBe(
      "https://otel.example.com/v1/traces",
    );
  });

  it("preserves a collector mounted under a path", () => {
    expect(normalizeOtlpTracesUrl("https://example.com/otel/", "production")).toBe(
      "https://example.com/otel/v1/traces",
    );
  });

  it("allows http for a loopback sidecar in production", () => {
    expect(normalizeOtlpTracesUrl("http://localhost:4318", "production")).toBe(
      "http://localhost:4318/v1/traces",
    );
    expect(normalizeOtlpTracesUrl("http://127.0.0.1:4318", "production")).toBe(
      "http://127.0.0.1:4318/v1/traces",
    );
  });

  it("rejects plaintext http to a remote collector in production", () => {
    expect(() => normalizeOtlpTracesUrl("http://otel.example.com", "production")).toThrow(
      TelemetryConfigError,
    );
  });

  it("accepts plaintext http outside production", () => {
    expect(normalizeOtlpTracesUrl("http://otel:4318", "development")).toBe(
      "http://otel:4318/v1/traces",
    );
  });

  it("rejects embedded credentials, query strings and fragments", () => {
    expect(() => normalizeOtlpTracesUrl("https://user:pass@otel.example.com", "production")).toThrow(
      /must not embed credentials/,
    );
    expect(() => normalizeOtlpTracesUrl("https://otel.example.com?token=x", "production")).toThrow(
      /query string/,
    );
    expect(() => normalizeOtlpTracesUrl("https://otel.example.com#frag", "production")).toThrow(
      /query string/,
    );
  });

  it("rejects non-http schemes and empty values", () => {
    expect(() => normalizeOtlpTracesUrl("ftp://otel.example.com", "production")).toThrow(
      TelemetryConfigError,
    );
    expect(() => normalizeOtlpTracesUrl("", "production")).toThrow(TelemetryConfigError);
    expect(() => normalizeOtlpTracesUrl("not a url", "production")).toThrow(TelemetryConfigError);
  });
});

describe("assertSampleRate", () => {
  it("accepts the closed interval 0..1", () => {
    expect(assertSampleRate(0, "rate")).toBe(0);
    expect(assertSampleRate(0.1, "rate")).toBe(0.1);
    expect(assertSampleRate(1, "rate")).toBe(1);
  });

  it("rejects out-of-range and non-finite values", () => {
    expect(() => assertSampleRate(-0.1, "rate")).toThrow(TelemetryConfigError);
    expect(() => assertSampleRate(1.1, "rate")).toThrow(TelemetryConfigError);
    expect(() => assertSampleRate(Number.NaN, "rate")).toThrow(TelemetryConfigError);
  });
});

describe("startTelemetry", () => {
  it("is a no-op when no endpoint or DSN is configured", async () => {
    const handle = await startTelemetry({
      serviceName: "freecall-web",
      environment: "test",
    });

    expect(handle.tracesEnabled).toBe(false);
    expect(handle.sentryEnabled).toBe(false);
    await handle.shutdown();
    await handle.shutdown();
  });

  it("rejects an unsafe service name", async () => {
    await expect(
      startTelemetry({ serviceName: "Freecall Web", environment: "test" }),
    ).rejects.toThrow(TelemetryConfigError);
  });

  it("rejects a missing environment", async () => {
    await expect(
      startTelemetry({ serviceName: "freecall-web", environment: "  " }),
    ).rejects.toThrow(TelemetryConfigError);
  });

  it("rejects invalid sampling rates before starting any SDK", async () => {
    await expect(
      startTelemetry({ serviceName: "freecall-web", environment: "test", tracesSampleRate: 2 }),
    ).rejects.toThrow(/tracesSampleRate/);

    await expect(
      startTelemetry({
        serviceName: "freecall-web",
        environment: "test",
        sentryTracesSampleRate: -1,
      }),
    ).rejects.toThrow(/sentryTracesSampleRate/);
  });

  it("rejects plaintext OTLP to a remote collector in production", async () => {
    await expect(
      startTelemetry({
        serviceName: "freecall-web",
        environment: "production",
        otlpEndpoint: "http://otel.example.com",
      }),
    ).rejects.toThrow(TelemetryConfigError);
  });

  it("rejects header injection", async () => {
    await expect(
      startTelemetry({
        serviceName: "freecall-web",
        environment: "test",
        otlpEndpoint: "https://otel.example.com",
        otlpHeaders: { authorization: "token\r\nx-injected: 1" },
      }),
    ).rejects.toThrow(/line break/);
  });

  it("rejects an invalid Sentry DSN", async () => {
    await expect(
      startTelemetry({
        serviceName: "freecall-web",
        environment: "test",
        sentryDsn: "not-a-dsn",
      }),
    ).rejects.toThrow(TelemetryConfigError);
  });

  it("rejects a plaintext Sentry DSN in production", async () => {
    await expect(
      startTelemetry({
        serviceName: "freecall-web",
        environment: "production",
        sentryDsn: "http://key@sentry.example.com/1",
      }),
    ).rejects.toThrow(/https/);
  });
});
