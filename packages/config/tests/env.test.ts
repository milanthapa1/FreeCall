import { describe, expect, it } from "vitest";
import {
  EnvValidationError,
  PublicEnvViolationError,
  duration,
  loadRealtimeEnv,
  loadWebEnv,
  requireTogether,
  webEnvSchema,
  type EnvSource,
} from "../src/index";
import { z } from "zod";

const baseWebEnv: EnvSource = {
  NODE_ENV: "test",
  DATABASE_URL: "postgres://app:dbpassword@localhost:5432/freecall",
  REDIS_URL: "redis://localhost:6379",
  BETTER_AUTH_SECRET: "b1d8f0c1a7e94f2d8c3b6a50e7d1c4f9",
  BETTER_AUTH_URL: "http://localhost:3000",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  LIVEKIT_API_URL: "http://localhost:7880",
  LIVEKIT_API_KEY: "devkey12",
  LIVEKIT_API_SECRET: "a3f1c9e7b5d24860a3f1c9e7b5d24860",
};

const baseRealtimeEnv: EnvSource = {
  NODE_ENV: "test",
  REGION: "iad",
  REDIS_URL: "redis://localhost:6379",
  LIVEKIT_API_URL: "http://localhost:7880",
  LIVEKIT_API_KEY: "devkey12",
  LIVEKIT_API_SECRET: "a3f1c9e7b5d24860a3f1c9e7b5d24860",
  JWT_DEV_SECRET: "c4e2a1b8d6f34970c4e2a1b8d6f34970",
};

describe("loadWebEnv", () => {
  it("parses a valid environment and applies defaults", () => {
    const env = loadWebEnv(baseWebEnv);
    expect(env.NODE_ENV).toBe("test");
    expect(env.MODERATION_ENABLED).toBe(true);
    expect(env.GUEST_MAX_MINUTES_PER_DAY).toBe(30);
  });

  it("fails fast when a required variable is missing, naming it", () => {
    const { DATABASE_URL: _omitted, ...withoutDb } = baseWebEnv;
    expect(() => loadWebEnv(withoutDb)).toThrow(EnvValidationError);
    try {
      loadWebEnv(withoutDb);
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const message = (error as EnvValidationError).message;
      expect(message).toContain("DATABASE_URL");
      expect(message).not.toContain("dbpassword");
    }
  });

  it("rejects short and placeholder secrets", () => {
    expect(() => loadWebEnv({ ...baseWebEnv, LIVEKIT_API_SECRET: "short" })).toThrow(
      /LIVEKIT_API_SECRET/,
    );
    expect(() => loadWebEnv({ ...baseWebEnv, BETTER_AUTH_SECRET: "changeme" })).toThrow(
      /BETTER_AUTH_SECRET/,
    );
  });

  it("rejects unlisted NEXT_PUBLIC_ variables", () => {
    expect(() =>
      loadWebEnv({ ...baseWebEnv, NEXT_PUBLIC_LIVEKIT_API_SECRET: "leaked" }),
    ).toThrow(PublicEnvViolationError);
  });

  it("requires all R2 variables when one is present", () => {
    expect(() => loadWebEnv({ ...baseWebEnv, R2_ACCOUNT_ID: "account" })).toThrow(
      /R2_ACCESS_KEY_ID/,
    );
  });

  it("rejects a Stripe key that is not a secret key", () => {
    expect(() => loadWebEnv({ ...baseWebEnv, STRIPE_SECRET_KEY: "pk_live_123" })).toThrow(
      /STRIPE_SECRET_KEY/,
    );
  });
});

describe("loadRealtimeEnv", () => {
  it("accepts a dev secret outside production", () => {
    const env = loadRealtimeEnv(baseRealtimeEnv);
    expect(env.REGION).toBe("iad");
    expect(env.MAX_SOCKETS_PER_POD).toBe(20_000);
    expect(env.DRAIN_TIMEOUT).toBe(120_000);
  });

  it("refuses a dev JWT secret in production", () => {
    expect(() => loadRealtimeEnv({ ...baseRealtimeEnv, NODE_ENV: "production" })).toThrow(
      /JWT_DEV_SECRET/,
    );
  });

  it("requires some JWT verification source", () => {
    const { JWT_DEV_SECRET: _omitted, ...withoutJwt } = baseRealtimeEnv;
    expect(() => loadRealtimeEnv(withoutJwt)).toThrow(/JWT_PUBLIC_KEY/);
  });
});

describe("primitives", () => {
  it("parses durations into milliseconds", () => {
    const schema = z.object({ t: duration });
    expect(schema.parse({ t: "500ms" }).t).toBe(500);
    expect(schema.parse({ t: "10s" }).t).toBe(10_000);
    expect(schema.parse({ t: "2m" }).t).toBe(120_000);
    expect(schema.parse({ t: "1h" }).t).toBe(3_600_000);
    expect(() => schema.parse({ t: "10" })).toThrow();
  });

  it("reports every missing member of a required group", () => {
    const issues: string[] = [];
    const ctx = {
      addIssue: (issue: { path?: (string | number)[] }) => {
        issues.push(String(issue.path?.join(".")));
      },
    } as unknown as z.RefinementCtx;
    requireTogether(["A", "B"])({ A: "set" }, ctx);
    expect(issues).toEqual(["B"]);
  });
});

describe("schema exports", () => {
  it("does not accept unknown keys silently on the env schema", () => {
    const result = webEnvSchema.safeParse({ ...baseWebEnv });
    expect(result.success).toBe(true);
  });
});
