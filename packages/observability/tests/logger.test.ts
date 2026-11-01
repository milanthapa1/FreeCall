import { describe, expect, it } from "vitest";
import {
  LogEventNameError,
  LogFieldError,
  createLogger,
  errorFields,
  type LoggerOptions,
} from "../src/logger";

const NOW = new Date("2026-10-30T12:00:00.000Z");

function harness(overrides: Partial<LoggerOptions> = {}) {
  const lines: string[] = [];
  const logger = createLogger({
    service: "freecall-realtime",
    environment: "test",
    version: "1.2.3",
    level: "debug",
    sink: { write: (line) => lines.push(line) },
    now: () => NOW,
    ...overrides,
  });

  const records = () =>
    lines.map((line) => {
      expect(line.endsWith("\n")).toBe(true);
      return JSON.parse(line) as Record<string, unknown>;
    });

  return { logger, lines, records };
}

describe("Logger", () => {
  it("writes one JSON object per line with the standard envelope", () => {
    const { logger, records } = harness();
    logger.info("http.request.completed", { method: "GET", status: 200, durationMs: 12 });

    const [record] = records();
    expect(record).toMatchObject({
      timestamp: NOW.toISOString(),
      level: "info",
      service: "freecall-realtime",
      environment: "test",
      version: "1.2.3",
      event: "http.request.completed",
      method: "GET",
      status: 200,
      durationMs: 12,
    });
  });

  it("omits the version field when no version is supplied", () => {
    const { logger, records } = harness({ version: undefined });
    logger.info("app.started");
    expect(records()[0]).not.toHaveProperty("version");
  });

  it("filters below the configured level", () => {
    const { logger, lines } = harness({ level: "warn" });
    logger.debug("cache.lookup.missed");
    logger.info("cache.lookup.hit");
    logger.warn("cache.lookup.degraded");
    logger.error("cache.lookup.failed");
    expect(lines).toHaveLength(2);
    expect(logger.isEnabled("debug")).toBe(false);
    expect(logger.isEnabled("warn")).toBe(true);
  });

  it("merges child bindings and lets call-site fields win", () => {
    const { logger, records } = harness({ bindings: { region: "iad" } });
    const child = logger.child({ region: "fra", market: "DE" });
    child.info("match.created", { market: "FR" });

    expect(records()[0]).toMatchObject({ region: "fra", market: "FR" });
  });

  it("rejects fields that are not on the privacy-reviewed allowlist", () => {
    const { logger } = harness();
    expect(() =>
      logger.info("user.signup", { email: "person@example.com" } as unknown as never),
    ).toThrow(LogFieldError);
  });

  it("rejects nested values, which are how request bodies leak", () => {
    const { logger } = harness();
    expect(() =>
      logger.info("http.request.completed", { count: { total: 1 } } as unknown as never),
    ).toThrow(LogFieldError);
  });

  it("rejects non-finite numbers instead of emitting NaN", () => {
    const { logger } = harness();
    expect(() => logger.info("http.request.completed", { durationMs: Number.NaN })).toThrow(
      LogFieldError,
    );
  });

  it("redacts sensitive values inside allowlisted string fields", () => {
    const { logger, records } = harness();
    logger.error("http.request.failed", {
      route: "/account/person@example.com",
      errorMessage: "connect failed from 203.0.113.9",
    });

    const record = records()[0]!;
    expect(record["route"]).toBe("/account/[redacted:email]");
    expect(record["errorMessage"]).toBe("connect failed from [redacted:ip]");
  });

  it("rejects malformed event names", () => {
    const { logger } = harness();
    expect(() => logger.info("HTTP request")).toThrow(LogEventNameError);
    expect(() => logger.info("single")).toThrow(LogEventNameError);
    expect(() => logger.info("UPPER.case")).toThrow(LogEventNameError);
  });

  it("does not serialise unknown error objects", () => {
    class OddError extends Error {
      readonly code = "E_ODD";
      readonly body = { password: "hunter2" };
    }

    expect(errorFields(new OddError("token expired"))).toEqual({
      errorName: "Error",
      errorMessage: "token expired",
      errorCode: "E_ODD",
    });

    expect(errorFields({ secret: "x" })).toEqual({
      errorName: "NonErrorThrown",
      errorMessage: "unserializable error",
    });

    expect(errorFields("raw failure")).toEqual({
      errorName: "NonErrorThrown",
      errorMessage: "raw failure",
    });
  });

  it("redacts emails and tokens inside error messages", () => {
    const fields = errorFields(new Error("auth failed for person@example.com"));
    expect(fields.errorMessage).toBe("auth failed for [redacted:email]");
  });
});
