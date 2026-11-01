/**
 * Singleton Redis client for the web tier.
 *
 * The web tier uses Redis only for rate limiting and session cap checks — not for
 * matchmaking queue operations (that lives in apps/realtime). The client is created once
 * per process and shared across route handlers.
 *
 * We use `lazyConnect: false` so a broken REDIS_URL surfaces at first request, not at
 * boot (Next.js dynamic routes). The connection is kept alive across requests.
 */
import Redis from "ioredis";
import { getWebEnv } from "./server-env";

let client: Redis | null = null;

export function getRedisClient(): Redis {
  if (client !== null) return client;

  const env = getWebEnv();
  client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 2,
    enableReadyCheck: false,
    lazyConnect: false,
    connectTimeout: 2_000,
  });

  client.on("error", (err: Error) => {
    // Log to stderr; do not crash the process. Rate limit checks fall through on error.
    process.stderr.write(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "warn",
        service: "freecall-web",
        event: "redis.connection.error",
        errorMessage: err.message,
      }) + "\n",
    );
  });

  return client;
}
