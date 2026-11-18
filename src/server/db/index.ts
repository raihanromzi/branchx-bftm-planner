// The app's database client: postgres.js with Drizzle (ADR 0005, docs/architecture.md).
// Nothing connects at import time, so `next build` works with no environment variables.
import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";

/**
 * prepare: false is required by Neon's connection pooler (PgBouncer in transaction mode),
 * and works the same against plain Postgres in development and CI.
 */
export const DB_CLIENT_OPTIONS = {
  prepare: false,
  max: 5,
  connect_timeout: 10,
  idle_timeout: 20,
  onnotice: () => {},
} as const satisfies postgres.Options<Record<string, postgres.PostgresType>>;

export type Sql = postgres.Sql;

export function createSqlClient(url: string): Sql {
  return postgres(url, DB_CLIENT_OPTIONS);
}

let cached: { url: string; sql: Sql; db: ReturnType<typeof drizzle<typeof schema>> } | undefined;

function client() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  if (cached?.url !== url) {
    // A changed URL (only in tests) gets a fresh client; the old one is closed in the background.
    void cached?.sql.end({ timeout: 0 });
    const sql = createSqlClient(url);
    cached = { url, sql, db: drizzle(sql, { schema }) };
  }
  return cached;
}

/** The raw postgres.js client for DATABASE_URL, created on first use. */
export function getSql(): Sql {
  return client().sql;
}

/** The Drizzle database for DATABASE_URL, created on first use. */
export function getDb() {
  return client().db;
}

export type Db = ReturnType<typeof getDb>;
/** A transaction handle from `getDb().transaction(...)`, with the same query API as Db. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
