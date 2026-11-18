// Test database helper (ADR 0005). Tests never run against Neon.
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

export const LOCAL_TEST_DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/bftm_test";

type Env = Record<string, string | undefined>;

/**
 * TEST_DATABASE_URL if set. In CI, where only DATABASE_URL is set (the service container's
 * bftm_test), DATABASE_URL. Otherwise the local Docker test database, never .env.local's.
 */
export function testDatabaseUrl(env: Env = process.env): string {
  const url = env.TEST_DATABASE_URL || (env.CI === "true" && env.DATABASE_URL) || LOCAL_TEST_DATABASE_URL;
  assertNotNeon(url);
  return url;
}

/** Throws when the URL points at Neon, so tests cannot reset a shared or production database. */
export function assertNotNeon(url: string): void {
  const host = new URL(url).hostname.toLowerCase();
  if (host === "neon.tech" || host.endsWith(".neon.tech")) {
    throw new Error("Refusing to run tests against a neon.tech database. Use the local Docker database (ADR 0005).");
  }
}

/** Applies the migrations in drizzle/ to the test database. Safe to call more than once. */
export async function migrateTestDatabase(url = testDatabaseUrl()): Promise<void> {
  assertNotNeon(url);
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  try {
    await migrate(drizzle(sql), { migrationsFolder: join(__dirname, "..", "..", "..", "drizzle") });
  } finally {
    await sql.end();
  }
}

/** Empties every table in the public schema. The migration journal lives in the drizzle schema and is kept. */
export async function truncateAllTables(sql: postgres.Sql): Promise<void> {
  const rows = await sql<{ name: string }[]>`
    select quote_ident(tablename) as name from pg_tables where schemaname = 'public'`;
  if (rows.length === 0) return;
  await sql.unsafe(`truncate table ${rows.map((row) => row.name).join(", ")} restart identity cascade`);
}
