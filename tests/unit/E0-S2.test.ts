import { execFile } from "node:child_process";
import { type AddressInfo, type Socket, createServer } from "node:net";
import { join } from "node:path";
import { promisify } from "node:util";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HEALTH_TIMEOUT_MS, healthResponse } from "@/server/health";
import { DB_CLIENT_OPTIONS, createSqlClient, getSql } from "@/server/db";
import { assertNotNeon, migrateTestDatabase, testDatabaseUrl, truncateAllTables } from "./support/test-db";

const root = join(__dirname, "..", "..");
const run = promisify(execFile);

const TEST_URL = testDatabaseUrl();
// Nothing listens on port 1, so connecting fails fast. The password is a marker that must never leak.
const CLOSED_URL = "postgresql://leakcheck:s3cret-marker@127.0.0.1:1/unreachable_db";

function withDatabaseUrl(url: string | undefined) {
  if (url === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = url;
}

/** Runs `npm run db:migrate` with exactly these database variables (NODE_ENV=test keeps .env.local out). */
async function runMigrate(env: { DATABASE_URL?: string; DATABASE_URL_UNPOOLED?: string }) {
  const { stdout } = await run("npm", ["run", "--silent", "db:migrate"], {
    cwd: root,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: "test", ...env },
  });
  return stdout;
}

describe("E0-S2 database client, migrations and health check", () => {
  const originalUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    await migrateTestDatabase(TEST_URL);
  });

  afterAll(() => {
    withDatabaseUrl(originalUrl);
  });

  describe("test database guard (ADR 0005)", () => {
    it("refuses a Neon host", () => {
      expect(() => assertNotNeon("postgresql://u:p@ep-x-pooler.ap-southeast-1.aws.neon.tech/db")).toThrow(/neon\.tech/);
      expect(() => assertNotNeon("postgresql://postgres:postgres@localhost:5432/bftm_test")).not.toThrow();
    });

    it("uses TEST_DATABASE_URL, then DATABASE_URL only in CI, then the local default", () => {
      expect(testDatabaseUrl({ TEST_DATABASE_URL: "postgresql://a@h/t", DATABASE_URL: "postgresql://b@h/d" })).toBe(
        "postgresql://a@h/t",
      );
      expect(testDatabaseUrl({ CI: "true", DATABASE_URL: "postgresql://b@h/d" })).toBe("postgresql://b@h/d");
      expect(testDatabaseUrl({ DATABASE_URL: "postgresql://b@h/d" })).toBe(
        "postgresql://postgres:postgres@localhost:5432/bftm_test",
      );
    });
  });

  describe("criterion 1: the client uses DATABASE_URL with prepare: false", () => {
    it("creates postgres.js clients with prepare disabled", () => {
      expect(DB_CLIENT_OPTIONS.prepare).toBe(false);
      const sql = createSqlClient(TEST_URL);
      try {
        expect(sql.options.prepare).toBe(false);
      } finally {
        void sql.end();
      }
    });

    it("reads DATABASE_URL lazily and fails clearly when it is missing", () => {
      withDatabaseUrl(undefined);
      expect(() => getSql()).toThrow(/DATABASE_URL/);
      withDatabaseUrl(TEST_URL);
      const sql = getSql();
      expect(sql.options.prepare).toBe(false);
      expect(sql.options.database).toBe(new URL(TEST_URL).pathname.slice(1));
    });
  });

  describe("criterion 2: the same client works against plain Postgres", () => {
    it("runs a query against the test database", async () => {
      withDatabaseUrl(TEST_URL);
      const rows = await getSql()`select 1 as one`;
      expect(rows[0].one).toBe(1);
    });

    it("can read and truncate the migrated tables", async () => {
      const sql = createSqlClient(TEST_URL);
      try {
        await sql`insert into idempotency_key (key, scope) values (${crypto.randomUUID()}, 'test')`;
        await truncateAllTables(sql);
        const [{ count }] = await sql`select count(*)::int as count from idempotency_key`;
        expect(count).toBe(0);
      } finally {
        await sql.end();
      }
    });
  });

  describe("criterion 3: db:migrate applies the first migration and is a no-op when run again", () => {
    const scratchDb = `bftm_migrate_${Date.now()}`;
    const admin = postgres(TEST_URL, { max: 1, prepare: false, onnotice: () => {} });
    const scratchUrl = (() => {
      const url = new URL(TEST_URL);
      url.pathname = `/${scratchDb}`;
      return url.toString();
    })();

    beforeAll(async () => {
      await admin.unsafe(`create database "${scratchDb}"`);
    });

    afterAll(async () => {
      await admin.unsafe(`drop database if exists "${scratchDb}" with (force)`);
      await admin.end();
    });

    async function inspect() {
      const sql = postgres(scratchUrl, { max: 1, prepare: false, onnotice: () => {} });
      try {
        const [{ tables }] = await sql`
          select count(*)::int as tables from information_schema.tables
          where table_schema = 'public' and table_name = 'idempotency_key'`;
        const [{ applied }] = await sql`select count(*)::int as applied from drizzle.__drizzle_migrations`;
        return { tables, applied };
      } finally {
        await sql.end();
      }
    }

    it("has a first migration in drizzle/", async () => {
      const { readdirSync } = await import("node:fs");
      expect(readdirSync(join(root, "drizzle")).some((name) => /^0000_.*\.sql$/.test(name))).toBe(true);
    });

    it("prefers DATABASE_URL_UNPOOLED over DATABASE_URL", async () => {
      // DATABASE_URL points nowhere, so success proves the unpooled URL was used.
      const out = await runMigrate({ DATABASE_URL: CLOSED_URL, DATABASE_URL_UNPOOLED: scratchUrl });
      expect(out).toContain("Migrations applied.");
      expect(await inspect()).toEqual({ tables: 1, applied: 1 });
    });

    it("is a no-op when run again, falling back to DATABASE_URL", async () => {
      const out = await runMigrate({ DATABASE_URL: scratchUrl });
      expect(out).toContain("Migrations applied.");
      expect(await inspect()).toEqual({ tables: 1, applied: 1 });
    });
  });

  // The route handler only adds `connection()` (request time) to healthResponse(); tests/e2e/E0-S2.spec.ts calls the real route.
  describe("criterion 4: GET /api/health", () => {
    it("returns 200 with status ok and database ok when the database answers", async () => {
      withDatabaseUrl(TEST_URL);
      const response = await healthResponse();
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(await response.json()).toEqual({ status: "ok", database: "ok" });
    });

    it("returns 503 with database error, without connection details, when the database is unreachable", async () => {
      withDatabaseUrl(CLOSED_URL);
      const errors: unknown[] = [];
      const original = console.error;
      console.error = (...args: unknown[]) => errors.push(args);
      try {
        const response = await healthResponse();
        expect(response.status).toBe(503);
        expect(response.headers.get("cache-control")).toContain("no-store");
        const text = await response.text();
        expect(JSON.parse(text)).toEqual({ status: "error", database: "error" });
        for (const secret of ["s3cret-marker", "leakcheck", "127.0.0.1", "unreachable_db", "postgres", "ECONNREFUSED"]) {
          expect(text).not.toContain(secret);
        }
        expect(errors.length).toBeGreaterThan(0);
      } finally {
        console.error = original;
      }
    });

    it("returns 503 within the timeout when the database accepts connections but never answers", async () => {
      // A TCP server that accepts and then stays silent, like a hung database.
      const sockets = new Set<Socket>();
      const server = createServer((socket) => sockets.add(socket));
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const { port } = server.address() as AddressInfo;
      withDatabaseUrl(`postgresql://postgres:postgres@127.0.0.1:${port}/hung`);
      const original = console.error;
      console.error = () => {};
      const started = Date.now();
      try {
        const response = await healthResponse();
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({ status: "error", database: "error" });
        expect(Date.now() - started).toBeLessThan(HEALTH_TIMEOUT_MS + 1500);
      } finally {
        console.error = original;
        for (const socket of sockets) socket.destroy();
        server.close();
      }
    }, 15_000);

    it("returns 503 when DATABASE_URL is not set", async () => {
      withDatabaseUrl(undefined);
      const original = console.error;
      console.error = () => {};
      try {
        const response = await healthResponse();
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({ status: "error", database: "error" });
      } finally {
        console.error = original;
      }
    });
  });
});
