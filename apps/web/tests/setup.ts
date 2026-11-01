/**
 * Vitest global setup for the web app.
 *
 * Injects the minimum environment variables required by `getWebEnv()` so tests
 * that import route handlers don't fail on missing env.
 *
 * Also stubs `getResolvedMarket` so tests run without a real database.
 */
import { vi, beforeAll } from "vitest";

// Inject environment before any module loads.
const TEST_ENV = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://freecall:freecall@localhost:5432/freecall_test",
  REDIS_URL: "redis://localhost:6379",
  BETTER_AUTH_SECRET: "test_secret_32_characters_minimum_val",
  BETTER_AUTH_URL: "http://localhost:3000",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  LIVEKIT_API_URL: "http://localhost:7880",
  LIVEKIT_API_KEY: "devkey12",
  LIVEKIT_API_SECRET: "devsecreetdevsecreetdevsecreetdevsecreet",
};

for (const [key, value] of Object.entries(TEST_ENV)) {
  process.env[key] = value;
}

// Stub the server-env cache reset so tests get a fresh env.
beforeAll(async () => {
  const { resetWebEnvForTests } = await import("../src/lib/server-env");
  resetWebEnvForTests();
});

// Stub `getResolvedMarket` to avoid DB calls in route tests.
// Individual tests can override with vi.mocked().mockResolvedValueOnce().
vi.mock("../src/lib/geo", () => ({
  getResolvedMarket: vi.fn(async (headers?: Headers | null) => {
    const country =
      (headers as Headers | undefined)?.get?.("cf-ipcountry") ?? "US";

    if (country === "US") {
      return {
        marketCode: "US",
        decision: {
          market: "US",
          serviceClass: "full",
          enabled: true,
          matchingEnabled: true,
          monetizationEnabled: true,
          requiredAgeTier: "t1_estimated",
          guestMinutesPerDay: 30,
          residency: "global",
          retentionDays: 90,
          reportingAuthority: "ncmec",
          policyVersion: 1,
          reasons: [],
        },
      };
    }

    // All other markets: blocked.
    return {
      marketCode: country,
      decision: {
        market: country,
        serviceClass: "blocked",
        enabled: false,
        matchingEnabled: false,
        monetizationEnabled: false,
        requiredAgeTier: "t1_estimated",
        guestMinutesPerDay: 0,
        residency: "global",
        retentionDays: 30,
        reportingAuthority: "pending_legal",
        policyVersion: 1,
        reasons: ["missing_policy_row"],
      },
    };
  }),
}));

// Stub Redis client to avoid real connections.
vi.mock("../src/lib/redis", () => ({
  getRedisClient: vi.fn(() => ({
    pipeline: () => ({
      incr: vi.fn().mockReturnThis(),
      ttl: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([[null, 1], [null, -1]]),
    }),
    set: vi.fn().mockResolvedValue("OK"),
    expire: vi.fn().mockResolvedValue(1),
    incr: vi.fn().mockResolvedValue(1),
    ttl: vi.fn().mockResolvedValue(-1),
    exists: vi.fn().mockResolvedValue(0),
  })),
}));

// Stub DB client to avoid real connections.
vi.mock("@freecall/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@freecall/db")>();
  return {
    ...original,
    createDb: vi.fn(() => ({
      db: {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
          }),
        }),
      },
      close: vi.fn().mockResolvedValue(undefined),
    })),
  };
});
