// E0-S3: Admin sign-in with email and password, database sessions and lockout (ADR 0002).
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { promisify } from "node:util";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, hashSessionToken } from "@/server/auth/session";
import { LOCKOUT_MESSAGE, INVALID_CREDENTIALS_MESSAGE } from "@/server/auth/sign-in";
import { POST as signInRoute } from "@/app/api/auth/sign-in/route";
import { POST as signOutRoute } from "@/app/api/auth/sign-out/route";
import { GET as meRoute } from "@/app/api/auth/me/route";
import { config as proxyConfig, proxy } from "@/proxy";
import { migrateTestDatabase, testDatabaseUrl, truncateAllTables } from "./support/test-db";

const root = join(__dirname, "..", "..");
const run = promisify(execFile);
const TEST_URL = testDatabaseUrl();
const ORIGIN = "http://localhost:3000";

const EMAIL = "admin@contoh.id";
const PASSWORD = "kata-sandi-benar-123";

let sql: postgres.Sql;

/** Runs the seed script against the test database, with the password only in ADMIN_PASSWORD. */
async function seed(args: string[], password: string | undefined) {
  return run("node", ["scripts/seed-admin.mts", ...args], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: "test",
      DATABASE_URL: TEST_URL,
      ...(password === undefined ? {} : { ADMIN_PASSWORD: password }),
    },
  });
}

async function insertAdmin(email = EMAIL, password = PASSWORD) {
  const [row] = await sql<{ id: string }[]>`
    insert into admin (email, password_hash) values (${email}, ${await hashPassword(password)}) returning id`;
  return row.id;
}

function signInRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/api/auth/sign-in`, {
    method: "POST",
    headers: { "content-type": "application/json", host: "localhost:3000", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function authedRequest(path: string, method: string, token?: string) {
  const headers: Record<string, string> = { host: "localhost:3000" };
  if (token !== undefined) headers.cookie = `${SESSION_COOKIE}=${token}`;
  return new Request(`${ORIGIN}${path}`, { method, headers });
}

function sessionToken(response: Response): string {
  const cookie = response.headers.get("set-cookie") ?? "";
  const match = new RegExp(`^${SESSION_COOKIE}=([^;]*)`).exec(cookie);
  if (!match) throw new Error(`no session cookie in ${JSON.stringify(cookie)}`);
  return match[1];
}

async function signIn(email = EMAIL, password = PASSWORD) {
  return signInRoute(signInRequest({ email, password }));
}

async function failuresFor(email: string) {
  const [row] = await sql<{ n: number }[]>`select count(*)::int as n from sign_in_attempt where email = ${email}`;
  return row.n;
}

describe("E0-S3 Admin sign-in", () => {
  const originalUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    await migrateTestDatabase(TEST_URL);
    process.env.DATABASE_URL = TEST_URL;
    sql = postgres(TEST_URL, { max: 1, prepare: false, onnotice: () => {} });
  });

  beforeEach(async () => {
    await truncateAllTables(sql);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await sql.end();
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
  });

  describe("criterion 1: the seed script creates or updates an Admin, storing only a strong hash", () => {
    it("hashes with scrypt N=2^15, r=8, p=1, a 16-byte salt and a 64-byte key, in a self-describing string", async () => {
      const hash = await hashPassword(PASSWORD);
      const [scheme, n, r, p, salt, key] = hash.split("$");
      expect([scheme, n, r, p]).toEqual(["scrypt", "32768", "8", "1"]);
      expect(Buffer.from(salt, "base64")).toHaveLength(16);
      expect(Buffer.from(key, "base64")).toHaveLength(64);
      expect(hash).not.toContain(PASSWORD);
      // A fresh salt every time.
      expect(await hashPassword(PASSWORD)).not.toBe(hash);
      expect(await verifyPassword(PASSWORD, hash)).toBe(true);
      expect(await verifyPassword("kata-sandi-salah", hash)).toBe(false);
      expect(await verifyPassword(PASSWORD, "not-a-hash")).toBe(false);
      expect(await verifyPassword(PASSWORD, "scrypt$2$1$1$AAAA$AAAA")).toBe(false);
    });

    it("creates an Admin with a normalised email, and the stored hash verifies the password", async () => {
      const { stdout, stderr } = await seed(["  Admin@Contoh.ID "], PASSWORD);
      expect(stdout + stderr).not.toContain(PASSWORD);

      const rows = await sql<{ email: string; password_hash: string }[]>`select email, password_hash from admin`;
      expect(rows).toHaveLength(1);
      expect(rows[0].email).toBe(EMAIL);
      expect(rows[0].password_hash).not.toContain(PASSWORD);
      expect(rows[0].password_hash.startsWith("scrypt$32768$8$1$")).toBe(true);
      expect(await verifyPassword(PASSWORD, rows[0].password_hash)).toBe(true);
    });

    it("updates the same Admin's password on a second run, and ends their sessions", async () => {
      await seed([EMAIL], PASSWORD);
      const [before] = await sql<{ id: string; updated_at: Date }[]>`select id, updated_at from admin`;
      const token = sessionToken(await signIn());

      await seed([EMAIL.toUpperCase()], "kata-sandi-baru-456");

      const rows = await sql<{ id: string; password_hash: string; updated_at: Date }[]>`
        select id, password_hash, updated_at from admin`;
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(before.id);
      expect(rows[0].updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime());
      expect(await verifyPassword("kata-sandi-baru-456", rows[0].password_hash)).toBe(true);
      expect(await verifyPassword(PASSWORD, rows[0].password_hash)).toBe(false);
      expect((await meRoute(authedRequest("/api/auth/me", "GET", token))).status).toBe(401);
    });

    it("refuses to run without an email, with an invalid email, or without a password to read", async () => {
      await expect(seed([], PASSWORD)).rejects.toMatchObject({ code: 1 });
      await expect(seed(["bukan-email"], PASSWORD)).rejects.toMatchObject({ code: 1 });
      // No ADMIN_PASSWORD and no terminal to prompt on: it stops instead of reading argv.
      await expect(seed([EMAIL], undefined)).rejects.toMatchObject({ code: 1 });
      await expect(seed([EMAIL], "pendek")).rejects.toMatchObject({ code: 1 });
      expect((await sql`select 1 from admin`).length).toBe(0);
    });
  });

  describe("criterion 2: a correct sign-in sets a 30-day httpOnly, SameSite=Lax session cookie", () => {
    it("answers 200 with the Admin and a session cookie; the database keeps only the token's hash", async () => {
      const adminId = await insertAdmin();
      const response = await signIn("  ADMIN@contoh.id ", PASSWORD);

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(await response.json()).toEqual({ admin: { email: EMAIL } });

      const cookie = response.headers.get("set-cookie") ?? "";
      const token = sessionToken(response);
      expect(Buffer.from(token, "base64url")).toHaveLength(32);
      expect(cookie).toMatch(/; HttpOnly/);
      expect(cookie).toMatch(/; SameSite=Lax/);
      expect(cookie).toMatch(/; Path=\//);
      expect(cookie).toMatch(/; Max-Age=2592000(;|$)/);
      expect(SESSION_MAX_AGE_SECONDS).toBe(30 * 24 * 60 * 60);
      expect(cookie).not.toMatch(/Secure/);

      const rows = await sql<{ admin_id: string; token_hash: string; expires_at: Date }[]>`
        select admin_id, token_hash, expires_at from session`;
      expect(rows).toHaveLength(1);
      expect(rows[0].admin_id).toBe(adminId);
      expect(rows[0].token_hash).toBe(createHash("sha256").update(token).digest("hex"));
      expect(rows[0].token_hash).toBe(hashSessionToken(token));
      const days = (rows[0].expires_at.getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(29.99);
      expect(days).toBeLessThanOrEqual(30.001);
    });

    it("marks the cookie Secure in production", async () => {
      await insertAdmin();
      vi.stubEnv("NODE_ENV", "production");
      const response = await signIn();
      expect(response.status).toBe(200);
      expect(response.headers.get("set-cookie")).toMatch(/; Secure/);
    });

    it("validates the body: not JSON, a bad email or a missing password is 400", async () => {
      expect((await signInRoute(signInRequest("{"))).status).toBe(400);
      const response = await signInRoute(signInRequest({ email: "bukan-email", password: "" }));
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe("validation");
      expect(Object.keys(body.error.fields).sort()).toEqual(["email", "password"]);
      expect(await failuresFor("bukan-email")).toBe(0);
    });

    it("refuses a sign-in from another origin with 403", async () => {
      await insertAdmin();
      const response = await signInRoute(
        signInRequest({ email: EMAIL, password: PASSWORD }, { origin: "https://jahat.example" }),
      );
      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe("forbidden_origin");
      expect(response.headers.get("set-cookie")).toBeNull();
    });
  });

  describe("criterion 3: a wrong email and a wrong password give the same error", () => {
    it("answers byte-identical 401 responses for an unknown email and a wrong password", async () => {
      await insertAdmin();
      const unknown = await signIn("tidak.ada@contoh.id", PASSWORD);
      const wrong = await signIn(EMAIL, "kata-sandi-salah");

      expect(unknown.status).toBe(401);
      expect(wrong.status).toBe(401);
      const [unknownText, wrongText] = [await unknown.text(), await wrong.text()];
      expect(unknownText).toBe(wrongText);
      expect(JSON.parse(wrongText)).toEqual({
        error: { code: "invalid_credentials", message: "Email atau kata sandi salah." },
      });
      expect(INVALID_CREDENTIALS_MESSAGE).toBe("Email atau kata sandi salah.");
      expect(unknown.headers.get("set-cookie")).toBeNull();
      expect(wrong.headers.get("set-cookie")).toBeNull();
      expect(unknown.headers.get("content-type")).toBe(wrong.headers.get("content-type"));
    });

    it("runs a password check for an unknown email too, so timing does not reveal it", async () => {
      await insertAdmin();
      const time = async (email: string) => {
        const start = performance.now();
        await signIn(email, "kata-sandi-salah");
        return performance.now() - start;
      };
      await time(EMAIL); // warm up
      const known = await time(EMAIL);
      const unknown = await time("tidak.ada@contoh.id");
      // Both run scrypt (tens of milliseconds); without the dummy check the unknown email would take ~1 ms.
      expect(unknown).toBeGreaterThan(known / 3);
    });
  });

  describe("criterion 4: 5 failures in 15 minutes lock the email for 15 minutes (EC41)", () => {
    it("refuses the 6th attempt even with the right password, with 429 locked_out", async () => {
      await insertAdmin();
      for (let i = 0; i < 5; i++) expect((await signIn(EMAIL, `salah-${i}`)).status).toBe(401);

      const locked = await signIn(EMAIL, PASSWORD);
      expect(locked.status).toBe(429);
      expect(await locked.json()).toEqual({
        error: { code: "locked_out", message: "Terlalu banyak percobaan. Coba lagi dalam 15 menit." },
      });
      expect(LOCKOUT_MESSAGE).toBe("Terlalu banyak percobaan. Coba lagi dalam 15 menit.");
      expect(locked.headers.get("set-cookie")).toBeNull();
      expect((await sql`select 1 from session`).length).toBe(0);
    });

    it("locks an unknown email the same way, with an identical response", async () => {
      await insertAdmin();
      for (let i = 0; i < 5; i++) {
        await signIn(EMAIL, "salah");
        await signIn("tidak.ada@contoh.id", "salah");
      }
      const known = await signIn(EMAIL, PASSWORD);
      const unknown = await signIn("tidak.ada@contoh.id", PASSWORD);
      expect(known.status).toBe(429);
      expect(unknown.status).toBe(429);
      expect(await unknown.text()).toBe(await known.text());
    });

    it("counts failures per normalised email, so another email is not locked", async () => {
      await insertAdmin();
      await insertAdmin("lain@contoh.id", PASSWORD);
      for (let i = 0; i < 5; i++) await signIn(i % 2 ? EMAIL.toUpperCase() : ` ${EMAIL}`, "salah");
      expect(await failuresFor(EMAIL)).toBe(5);
      expect((await signIn(EMAIL, PASSWORD)).status).toBe(429);
      expect((await signIn("lain@contoh.id", PASSWORD)).status).toBe(200);
    });

    it("lets the right password in again once the failures are older than 15 minutes", async () => {
      await insertAdmin();
      for (let i = 0; i < 5; i++) await signIn(EMAIL, "salah");
      expect((await signIn(EMAIL, PASSWORD)).status).toBe(429);
      // Refused attempts do not extend the lockout.
      expect(await failuresFor(EMAIL)).toBe(5);

      await sql`update sign_in_attempt set attempted_at = attempted_at - interval '14 minutes'`;
      expect((await signIn(EMAIL, PASSWORD)).status).toBe(429);

      await sql`update sign_in_attempt set attempted_at = attempted_at - interval '1 minute 1 second'`;
      expect((await signIn(EMAIL, PASSWORD)).status).toBe(200);
      expect(await failuresFor(EMAIL)).toBe(0);
    });

    it("clears the email's failures on a successful sign-in", async () => {
      await insertAdmin();
      for (let i = 0; i < 4; i++) await signIn(EMAIL, "salah");
      expect((await signIn(EMAIL, PASSWORD)).status).toBe(200);
      for (let i = 0; i < 4; i++) await signIn(EMAIL, "salah");
      expect((await signIn(EMAIL, PASSWORD)).status).toBe(200);
    });

    it("does not let parallel guesses get past the limit", async () => {
      await insertAdmin();
      const responses = await Promise.all(Array.from({ length: 12 }, () => signIn(EMAIL, "salah")));
      const statuses = responses.map((response) => response.status);
      expect(statuses.filter((status) => status === 401)).toHaveLength(5);
      expect(statuses.filter((status) => status === 429)).toHaveLength(7);
      expect(await failuresFor(EMAIL)).toBe(5);
    });
  });

  describe("criterion 5: every API route except sign-in and health answers 401 without a valid session (EC39)", () => {
    const PUBLIC_ROUTES = new Set(["api/auth/sign-in/route.ts", "api/health/route.ts"]);
    const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;
    const appDir = join(root, "src", "app");

    function routeFiles(dir: string): string[] {
      return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return routeFiles(path);
        return /^route\.(ts|tsx|js)$/.test(entry.name) ? [path] : [];
      });
    }

    /** A URL for the route file, with each [param] filled in with a valid-looking UUID. */
    function urlFor(file: string) {
      const segments = relative(appDir, file).split(sep).slice(0, -1);
      const params: Record<string, string | string[]> = {};
      const path = segments
        .filter((segment) => !/^\(.*\)$/.test(segment))
        .map((segment) => {
          const match = /^\[(?:\.\.\.)?(.+?)\]$/.exec(segment.replace(/^\[\[(.*)\]\]$/, "[$1]"));
          if (!match) return segment;
          const value = "00000000-0000-4000-8000-000000000000";
          params[match[1]] = segment.includes("...") ? [value] : value;
          return value;
        })
        .join("/");
      return { path: `/${path}`, params };
    }

    const protectedRoutes = routeFiles(join(appDir, "api"))
      .map((file) => ({ file, key: relative(appDir, file).split(sep).join("/") }))
      .filter(({ key }) => !PUBLIC_ROUTES.has(key));

    it("finds the protected routes, including the auth ones", () => {
      const keys = protectedRoutes.map(({ key }) => key);
      expect(keys).toContain("api/auth/me/route.ts");
      expect(keys).toContain("api/auth/sign-out/route.ts");
    });

    it("answers 401 unauthorized for every exported method, with no cookie, a forged cookie or an expired session", async () => {
      const adminId = await insertAdmin();
      const expired = "kedaluwarsa-token";
      await sql`
        insert into session (admin_id, token_hash, expires_at)
        values (${adminId}, ${hashSessionToken(expired)}, now() - interval '1 second')`;

      let checked = 0;
      for (const { file, key } of protectedRoutes) {
        const route = (await import(file)) as Record<string, unknown>;
        const { path, params } = urlFor(file);
        for (const method of METHODS) {
          const handler = route[method];
          if (typeof handler !== "function") continue;
          for (const token of [undefined, "palsu", expired]) {
            const request = new Request(`${ORIGIN}${path}`, {
              method,
              headers: {
                host: "localhost:3000",
                "content-type": "application/json",
                ...(token ? { cookie: `${SESSION_COOKIE}=${token}` } : {}),
              },
              ...(["GET", "HEAD", "OPTIONS"].includes(method) ? {} : { body: "{}" }),
            });
            const response = (await handler(request, { params: Promise.resolve(params) })) as Response;
            expect(response.status, `${method} ${key} with ${token ?? "no"} cookie`).toBe(401);
            if (method !== "HEAD") {
              expect((await response.json()).error.code, `${method} ${key}`).toBe("unauthorized");
            }
            checked++;
          }
        }
      }
      expect(checked).toBeGreaterThanOrEqual(6);
    });

    it("GET /api/auth/me answers the signed-in Admin, and 401 once the session has expired", async () => {
      await insertAdmin();
      const token = sessionToken(await signIn());
      const me = await meRoute(authedRequest("/api/auth/me", "GET", token));
      expect(me.status).toBe(200);
      expect(me.headers.get("cache-control")).toContain("no-store");
      expect(await me.json()).toEqual({ admin: { email: EMAIL } });

      await sql`update session set expires_at = now() - interval '1 second'`;
      const after = await meRoute(authedRequest("/api/auth/me", "GET", token));
      expect(after.status).toBe(401);
      expect(await after.json()).toEqual({
        error: { code: "unauthorized", message: "Sesi Anda sudah berakhir. Silakan masuk lagi." },
      });
    });

    describe("proxy.ts: optimistic cookie check, no database", () => {
      const call = (path: string, cookie?: string) =>
        proxy(
          new NextRequest(`${ORIGIN}${path}`, {
            headers: cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {},
          }),
        );
      const passes = (response: Response) => response.headers.get("x-middleware-next") === "1";

      it("answers 401 in the shared error shape for an API path without a session cookie", async () => {
        const response = call("/api/prospects");
        expect(response.status).toBe(401);
        expect(response.headers.get("cache-control")).toContain("no-store");
        expect(await response.json()).toEqual({
          error: { code: "unauthorized", message: "Sesi Anda sudah berakhir. Silakan masuk lagi." },
        });
        expect(call("/api/auth/me").status).toBe(401);
        expect(call("/api/auth/sign-out").status).toBe(401);
      });

      it("lets sign-in, health and the sign-in page through without a cookie", () => {
        expect(passes(call("/api/auth/sign-in"))).toBe(true);
        expect(passes(call("/api/health"))).toBe(true);
        expect(passes(call("/masuk"))).toBe(true);
        expect(passes(call("/masuk?next=%2Fprospek"))).toBe(true);
        // Not a prefix match: lookalike paths are still protected.
        expect(call("/api/healthz").status).toBe(401);
        expect(call("/api/auth/sign-in-extra").status).toBe(401);
      });

      it("redirects a page without a session cookie to /masuk with the path to return to", () => {
        const home = call("/");
        expect(home.status).toBe(307);
        expect(home.headers.get("location")).toBe(`${ORIGIN}/masuk?next=%2F`);
        const deep = call("/prospek/abc?tab=pipeline");
        expect(deep.headers.get("location")).toBe(`${ORIGIN}/masuk?next=%2Fprospek%2Fabc%3Ftab%3Dpipeline`);
      });

      it("lets any request with a session cookie through (the route checks it against the database)", () => {
        expect(passes(call("/", "apa-saja"))).toBe(true);
        expect(passes(call("/api/auth/me", "apa-saja"))).toBe(true);
      });

      it("does not run on static files", () => {
        const matches = (url: string) => unstable_doesMiddlewareMatch({ config: proxyConfig, url });
        expect(matches("/")).toBe(true);
        expect(matches("/prospek")).toBe(true);
        expect(matches("/api/auth/me")).toBe(true);
        expect(matches("/_next/static/chunks/main.js")).toBe(false);
        expect(matches("/_next/image?url=%2Fa.png&w=64&q=75")).toBe(false);
        expect(matches("/favicon.ico")).toBe(false);
        expect(matches("/manifest.webmanifest")).toBe(false);
        expect(matches("/icons/icon-192.png")).toBe(false);
        expect(matches("/robots.txt")).toBe(false);
      });
    });
  });

  describe("criterion 6: signing out ends the session on the server", () => {
    it("deletes the session and clears the cookie, so the old cookie no longer works", async () => {
      await insertAdmin();
      const token = sessionToken(await signIn());
      expect((await meRoute(authedRequest("/api/auth/me", "GET", token))).status).toBe(200);

      const response = await signOutRoute(authedRequest("/api/auth/sign-out", "POST", token));
      expect(response.status).toBe(204);
      const cookie = response.headers.get("set-cookie") ?? "";
      expect(cookie).toMatch(new RegExp(`^${SESSION_COOKIE}=;`));
      expect(cookie).toMatch(/; Max-Age=0(;|$)/);
      expect(cookie).toMatch(/; HttpOnly/);
      expect(cookie).toMatch(/; Path=\//);

      expect((await sql`select 1 from session where token_hash = ${hashSessionToken(token)}`).length).toBe(0);
      expect((await meRoute(authedRequest("/api/auth/me", "GET", token))).status).toBe(401);
      // A second sign-out with the old cookie is 401, and still clears the cookie.
      const again = await signOutRoute(authedRequest("/api/auth/sign-out", "POST", token));
      expect(again.status).toBe(401);
      expect(again.headers.get("set-cookie")).toMatch(/; Max-Age=0(;|$)/);
    });

    it("ends only that session; another device stays signed in", async () => {
      await insertAdmin();
      const first = sessionToken(await signIn());
      const second = sessionToken(await signIn());
      await signOutRoute(authedRequest("/api/auth/sign-out", "POST", first));
      expect((await meRoute(authedRequest("/api/auth/me", "GET", second))).status).toBe(200);
    });

    it("refuses a sign-out from another origin with 403 and keeps the session", async () => {
      await insertAdmin();
      const token = sessionToken(await signIn());
      const request = new Request(`${ORIGIN}/api/auth/sign-out`, {
        method: "POST",
        headers: { host: "localhost:3000", origin: "https://jahat.example", cookie: `${SESSION_COOKIE}=${token}` },
      });
      expect((await signOutRoute(request)).status).toBe(403);
      expect((await meRoute(authedRequest("/api/auth/me", "GET", token))).status).toBe(200);
    });
  });
});
