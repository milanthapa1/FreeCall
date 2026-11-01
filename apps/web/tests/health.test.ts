import { describe, expect, it } from "vitest";
import {
  DependencyTimeoutError,
  aggregateStatus,
  httpStatusFor,
  probeDependency,
  withTimeout,
  type DependencyHealth,
} from "@freecall/observability";

describe("withTimeout", () => {
  it("resolves a promise that finishes inside the budget", async () => {
    await expect(withTimeout(Promise.resolve("done"), 50, "test")).resolves.toBe("done");
  });

  it("rejects with a typed timeout error", async () => {
    const never = new Promise<string>(() => undefined);
    await expect(withTimeout(never, 10, "redis")).rejects.toBeInstanceOf(DependencyTimeoutError);
  });

  it("names the dependency without leaking its address", async () => {
    try {
      await withTimeout(new Promise(() => undefined), 5, "postgres");
      expect.unreachable("expected a timeout");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("postgres");
      expect((error as Error).message).not.toContain("://");
    }
  });
});

describe("probeDependency", () => {
  it("reports up with a latency measurement", async () => {
    const clock = [100, 142];
    const result = await probeDependency("redis", async () => "up", {
      now: () => clock.shift() ?? 142,
    });
    expect(result).toEqual({ status: "up", latencyMs: 42 });
  });

  it("preserves an explicit not_configured result", async () => {
    const result = await probeDependency("storage", async () => "not_configured");
    expect(result.status).toBe("not_configured");
    expect(result.failure).toBeUndefined();
  });

  it("maps a thrown error to down without exposing the message", async () => {
    const result = await probeDependency("postgres", async () => {
      throw new Error("postgres://user:password@host/db is unreachable");
    });

    expect(result.status).toBe("down");
    expect(result.failure).toBe("error");
    expect(JSON.stringify(result)).not.toContain("password");
  });

  it("distinguishes a timeout from a failure", async () => {
    const result = await probeDependency("livekit", () => new Promise(() => undefined), {
      timeoutMs: 5,
    });
    expect(result).toEqual({ status: "down", failure: "timeout", latencyMs: expect.any(Number) });
  });
});

describe("aggregateStatus", () => {
  const up: DependencyHealth = { status: "up" };
  const down: DependencyHealth = { status: "down" };
  const missing: DependencyHealth = { status: "not_configured" };

  it("is ok when every dependency is up", () => {
    expect(aggregateStatus([up, up, up])).toBe("ok");
  });

  it("is degraded when something optional is not configured", () => {
    expect(aggregateStatus([up, missing, up])).toBe("degraded");
  });

  it("is down when any configured dependency is down, even if others are degraded", () => {
    expect(aggregateStatus([missing, down, up])).toBe("down");
  });

  it("is ok for an empty set", () => {
    expect(aggregateStatus([])).toBe("ok");
  });
});

describe("httpStatusFor", () => {
  it("keeps degraded instances in rotation and removes down instances", () => {
    expect(httpStatusFor("ok")).toBe(200);
    expect(httpStatusFor("degraded")).toBe(200);
    expect(httpStatusFor("down")).toBe(503);
  });
});
