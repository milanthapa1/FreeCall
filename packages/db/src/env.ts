import { z } from "zod";
import { booleanDefault, loadEnv, nodeEnv, postgresUrl, type EnvSource } from "@freecall/config";

/**
 * Environment for the database package and its CLI scripts. Applications validate their
 * own environment at boot; scripts use this so `db:migrate` and `db:seed` fail with the
 * same precision as the servers.
 */
export const dbEnvSchema = z.object({
  NODE_ENV: nodeEnv,
  DATABASE_URL: postgresUrl,
  /**
   * Migrations hold locks and use session state, so they must not run through a
   * transaction-mode pooler. Set this to the direct Neon/Postgres URL in production.
   */
  MIGRATE_DATABASE_URL: postgresUrl.optional(),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  DB_CONNECT_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(60).default(10),
  DB_IDLE_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(600).default(30),
  DB_SSL: booleanDefault(false),
});

export type DbEnv = z.infer<typeof dbEnvSchema>;

export function loadDbEnv(source: EnvSource = process.env): DbEnv {
  return loadEnv(dbEnvSchema, "db", source);
}
