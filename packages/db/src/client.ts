import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import * as schema from "./schema/index";

export type Database = PostgresJsDatabase<typeof schema>;

export interface CreateDbOptions {
  /** Connection pool size. Use 1 for migrations and seeds. */
  max?: number;
  /** Seconds a connection may sit idle before being closed. */
  idleTimeoutSeconds?: number;
  /** Seconds to wait for a TCP/TLS connection. */
  connectTimeoutSeconds?: number;
  /** Requires TLS. Set in production; local Docker Postgres does not need it. */
  ssl?: boolean;
  /** Shown in `pg_stat_activity`; set per process so slow queries are attributable. */
  applicationName?: string;
}

export interface DbHandle {
  db: Database;
  /** Raw client, for the rare query Drizzle cannot express (COPY, LISTEN is banned). */
  client: Sql;
  close: (options?: { timeout?: number }) => Promise<void>;
}

/**
 * Creates a Drizzle client.
 *
 * `prepare: false` is mandatory: production sits behind a transaction-mode pooler
 * (pgbouncer/Neon), where server-side prepared statements are unsupported. Session-state
 * features (advisory locks, LISTEN/NOTIFY, `SET`) are banned in application code for the
 * same reason; migrations use a direct connection instead.
 */
export function createDb(url: string, options: CreateDbOptions = {}): DbHandle {
  if (!url.trim()) {
    throw new Error("createDb: a database URL is required");
  }

  const client = postgres(url, {
    prepare: false,
    max: options.max ?? 10,
    idle_timeout: options.idleTimeoutSeconds ?? 30,
    connect_timeout: options.connectTimeoutSeconds ?? 10,
    connection: { application_name: options.applicationName ?? "freecall" },
    onnotice: () => undefined,
    ...(options.ssl ? { ssl: "require" as const } : {}),
  });

  return {
    db: drizzle(client, { schema }),
    client,
    close: (closeOptions) => client.end(closeOptions),
  };
}

/**
 * Cheap liveness probe. Returns false instead of throwing so health routes can report a
 * dependency as down without a stack trace ending up in a response body.
 */
export async function pingDatabase(db: Database): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}
