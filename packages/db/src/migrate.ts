import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./client";
import { loadDotenv } from "./dotenv";
import { loadDbEnv } from "./env";

/**
 * Applies pending migrations. Must use a direct (non-pooled) connection because the
 * migrator relies on transactions and locks; set `MIGRATE_DATABASE_URL` in production.
 */
async function main(): Promise<void> {
  loadDotenv();
  const env = loadDbEnv();
  const url = env.MIGRATE_DATABASE_URL ?? env.DATABASE_URL;
  const handle = createDb(url, {
    max: 1,
    applicationName: "freecall-migrate",
    ssl: env.DB_SSL,
    connectTimeoutSeconds: env.DB_CONNECT_TIMEOUT_SECONDS,
  });

  try {
    await migrate(handle.db, {
      migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
    });
    console.log("migrations applied");
  } finally {
    await handle.close({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error(
    `migration failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
