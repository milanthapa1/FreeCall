import { defineConfig } from "drizzle-kit";

/**
 * `generate` is offline: the placeholder URL is only used by `push`/`migrate`, which run
 * through `src/migrate.ts` and validate a real `DATABASE_URL` first.
 */
const url = process.env["DATABASE_URL"] ?? "postgres://localhost:5432/freecall";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
