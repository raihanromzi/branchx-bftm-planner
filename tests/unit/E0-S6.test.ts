// E0-S6: shared input rules for every form (phone, free text, idempotent creates, version checks, error shape).
import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  CUSTOMER_NUMBER_MESSAGE,
  FREE_TEXT_MAX,
  PHONE_MESSAGE,
  VERSION_CONFLICT_MESSAGE,
  containsCustomerNumber,
  freeText,
  normalizePhone,
  optionalFreeText,
  phone,
  version,
} from "@/server/validation";
import {
  ApiError,
  assertSameOrigin,
  errorResponse,
  parseJson,
  readIdempotencyKey,
  toErrorResponse,
  updateWithVersion,
  validationError,
  withIdempotency,
} from "@/server/http";
import { getDb } from "@/server/db";
import { migrateTestDatabase, testDatabaseUrl } from "./support/test-db";

const TEST_URL = testDatabaseUrl();

async function body(response: Response) {
  return (await response.json()) as { error: { code: string; message: string; fields?: Record<string, string> } };
}

describe("E0-S6 shared input rules", () => {
  describe("criterion 1: phone numbers are normalised to +62", () => {
    it.each([
      ["081234567890", "+6281234567890"],
      ["0812 3456 7890", "+6281234567890"],
      ["0812-3456-7890", "+6281234567890"],
      ["6281234567890", "+6281234567890"],
      ["62 812 3456 7890", "+6281234567890"],
      ["+6281234567890", "+6281234567890"],
      ["+62 812-3456-7890", "+6281234567890"],
      ["  +62 812 3456 7890  ", "+6281234567890"],
      ["021 1234 567", "+62211234567"], // 9 digits after the country code: the minimum
      ["0812 3456 7890 12", "+628123456789012"], // 13 digits after the country code: the maximum
    ])("stores %s as %s", (input, expected) => {
      expect(normalizePhone(input)).toBe(expected);
      const parsed = phone.safeParse(input);
      expect(parsed.success && parsed.data).toBe(expected);
    });

    it.each([
      "0812 345 67", // 8 digits after the country code
      "+62 812 3456 7890 1234", // 14 digits
      "62 8123 4567", // 8 digits
      "8123456789", // no 0, 62 or +62 prefix
      "+1 202 555 0123",
      "0812-ABCD-7890",
      "",
      "+62 0812 3456 7890", // a trunk 0 after the country code
    ])("rejects %j with the exact message", (input) => {
      expect(normalizePhone(input)).toBeNull();
      const parsed = phone.safeParse(input);
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0].message).toBe("Nomor telepon tidak valid. Contoh: 0812 3456 7890");
      expect(PHONE_MESSAGE).toBe("Nomor telepon tidak valid. Contoh: 0812 3456 7890");
    });
  });

  describe("criterion 2: free text is at most 500 characters", () => {
    it("accepts 500 and rejects 501 characters", () => {
      expect(FREE_TEXT_MAX).toBe(500);
      expect(freeText().safeParse("a".repeat(500)).success).toBe(true);
      const parsed = freeText().safeParse("a".repeat(501));
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0].message).toBe("Maksimal 500 karakter.");
    });

    it("counts characters, not UTF-16 code units, and trims first", () => {
      expect(freeText().safeParse("😀".repeat(500)).success).toBe(true);
      expect(freeText().parse(`  ${"a".repeat(500)}  `)).toBe("a".repeat(500));
    });

    it("supports a smaller maximum", () => {
      expect(freeText({ max: 100 }).safeParse("a".repeat(101)).error?.issues[0].message).toBe("Maksimal 100 karakter.");
    });

    it("requires a value; the optional variant turns empty into null", () => {
      expect(freeText().safeParse("   ").error?.issues[0].message).toBe("Wajib diisi.");
      expect(optionalFreeText().parse("   ")).toBeNull();
      expect(optionalFreeText().parse(undefined)).toBeNull();
      expect(optionalFreeText().parse(null)).toBeNull();
      expect(optionalFreeText().parse(" ok ")).toBe("ok");
      expect(optionalFreeText().safeParse("a".repeat(501)).success).toBe(false);
    });
  });

  describe("criterion 3: free text rejects NIK and account numbers", () => {
    it.each([
      "NIK 3201234567890001",
      "NIK 3201 2345 6789 0001",
      "NIK 3201.2345.6789.0001",
      "NIK 3201-2345-6789-0001",
      "NIK 3201 - 2345 - 6789 - 0001",
      "rekening 1234567890",
      "rek. 123-456-7890",
      "rekening 0012345678901",
      "no 6281234567890123", // 16 digits even though it starts with 62
      "18-11-2026 NIK 3201 2345 6789 0001", // a date does not hide a NIK next to it
      "rekening 1234567890 tanggal 18-11-2026",
    ])("rejects %j", (text) => {
      expect(containsCustomerNumber(text)).toBe(true);
      const parsed = freeText().safeParse(text);
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0].message).toBe("Jangan tulis NIK atau nomor rekening nasabah.");
      expect(CUSTOMER_NUMBER_MESSAGE).toBe("Jangan tulis NIK atau nomor rekening nasabah.");
      expect(optionalFreeText().safeParse(text).success).toBe(false);
    });

    it.each([
      "Hubungi Pak Budi di 0812 3456 7890",
      "WA +62 812-3456-7890 sore hari",
      "Telp 021-1234-5678",
      "350 rekening",
      "Blok B 12",
      "Target 1.250 rekening sampai 31-12",
      "Rapat 18/11/2026 pukul 10.30",
      "Kunjungan 18-11-2026 10.30",
      "Kunjungan 18.11.2026 pukul 09.00 - 11.30",
      "Jadwal ulang 2026-11-18 10.30 WIB",
      "Kelas 7\n12 guru\n350 siswa\n40 orang tua",
      "Tidak ada angka",
    ])("accepts %j", (text) => {
      expect(containsCustomerNumber(text)).toBe(false);
      expect(freeText().safeParse(text).success).toBe(true);
    });
  });

  describe("criterion 6: validation errors come back per field in one shape", () => {
    const schema = z.object({
      name: freeText({ max: 100 }),
      contact: z.object({ phone }),
      note: optionalFreeText(),
    });

    it("maps a zod error to 400 with per-field messages, paths joined with '.'", async () => {
      const parsed = schema.safeParse({ name: "", contact: { phone: "123" }, note: "NIK 3201234567890001" });
      expect(parsed.success).toBe(false);
      const response = validationError(parsed.error!);
      expect(response.status).toBe(400);
      expect(await body(response)).toEqual({
        error: {
          code: "validation",
          message: "Periksa kembali isian yang ditandai.",
          fields: {
            name: "Wajib diisi.",
            "contact.phone": "Nomor telepon tidak valid. Contoh: 0812 3456 7890",
            note: "Jangan tulis NIK atau nomor rekening nasabah.",
          },
        },
      });
    });

    it("parseJson validates a request body and throws a 400 ApiError", async () => {
      const ok = await parseJson(
        new Request("http://localhost/api/x", { method: "POST", body: JSON.stringify({ name: " A ", contact: { phone: "0812 3456 7890" } }) }),
        schema,
      );
      expect(ok).toEqual({ name: "A", contact: { phone: "+6281234567890" }, note: null });

      const bad = await parseJson(new Request("http://localhost/api/x", { method: "POST", body: "{" }), schema).catch((e) => e);
      expect(bad).toBeInstanceOf(ApiError);
      const badResponse = toErrorResponse(bad);
      expect(badResponse.status).toBe(400);
      expect((await body(badResponse)).error.code).toBe("invalid_json");

      const invalid = await parseJson(
        new Request("http://localhost/api/x", { method: "POST", body: JSON.stringify({ name: "A" }) }),
        schema,
      ).catch((e) => e);
      const invalidResponse = toErrorResponse(invalid);
      expect(invalidResponse.status).toBe(400);
      expect((await body(invalidResponse)).error.fields).toEqual({ "contact": "Wajib diisi." });
    });

    it.each([
      [401, "unauthorized"],
      [404, "not_found"],
      [409, "conflict"],
      [422, "invalid_state"],
    ])("returns %i in the same shape", async (status, code) => {
      const response = errorResponse(status, code, "Pesan.");
      expect(response.status).toBe(status);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(await body(response)).toEqual({ error: { code, message: "Pesan." } });
    });

    it("hides unexpected errors behind a generic 500", async () => {
      const original = console.error;
      console.error = () => {};
      try {
        const response = toErrorResponse(new Error("connection to db.secret-host failed"));
        expect(response.status).toBe(500);
        const text = await response.text();
        expect(text).not.toContain("secret-host");
        expect(JSON.parse(text).error.code).toBe("internal");
      } finally {
        console.error = original;
      }
    });

    it("validates the version field as an integer of at least 1", () => {
      expect(version.safeParse(1).success).toBe(true);
      expect(version.safeParse(0).success).toBe(false);
      expect(version.safeParse(1.5).success).toBe(false);
      expect(version.safeParse("1").success).toBe(false);
      expect(version.safeParse(undefined).success).toBe(false);
    });
  });

  describe("Origin check (ADR 0002)", () => {
    const post = (headers: Record<string, string>) =>
      new Request("http://planner.example/api/x", { method: "POST", headers });

    it("allows a mutation without an Origin header or from the same host", () => {
      expect(() => assertSameOrigin(post({ host: "planner.example" }))).not.toThrow();
      expect(() => assertSameOrigin(post({ host: "planner.example", origin: "http://planner.example" }))).not.toThrow();
      expect(() =>
        assertSameOrigin(post({ host: "internal:3000", "x-forwarded-host": "planner.example", origin: "https://planner.example" })),
      ).not.toThrow();
    });

    it.each(["https://evil.example", "null", "not a url"])("rejects Origin %j with 403 in the error shape", async (origin) => {
      const error = (() => {
        try {
          assertSameOrigin(post({ host: "planner.example", origin }));
        } catch (e) {
          return e;
        }
      })();
      expect(error).toBeInstanceOf(ApiError);
      const response = toErrorResponse(error);
      expect(response.status).toBe(403);
      expect((await body(response)).error.code).toBe("forbidden_origin");
    });

    it("does not check safe methods", () => {
      expect(() =>
        assertSameOrigin(new Request("http://planner.example/api/x", { headers: { host: "planner.example", origin: "https://evil.example" } })),
      ).not.toThrow();
    });
  });

  // A table that exists only for these tests, so the shared helpers can be proven before any domain table exists.
  const thing = pgTable("e0s6_thing", {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  });

  describe("database helpers", () => {
    const originalUrl = process.env.DATABASE_URL;
    let sql: postgres.Sql;

    beforeAll(async () => {
      await migrateTestDatabase(TEST_URL);
      process.env.DATABASE_URL = TEST_URL;
      sql = postgres(TEST_URL, { max: 1, prepare: false, onnotice: () => {} });
      await sql`drop table if exists e0s6_thing`;
      await sql`create table e0s6_thing (
        id uuid primary key default gen_random_uuid(),
        name text not null,
        version integer not null default 1,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now())`;
    });

    beforeEach(async () => {
      await sql`truncate e0s6_thing, idempotency_key`;
    });

    afterAll(async () => {
      await sql`drop table if exists e0s6_thing`;
      await sql`truncate idempotency_key`;
      await sql.end();
      if (originalUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = originalUrl;
    });

    const count = async () => (await sql`select count(*)::int as n from e0s6_thing`)[0].n as number;

    describe("criterion 4: idempotent creates", () => {
      const createThing = (name: string, delayMs = 0) =>
        async (tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0]) => {
          const [row] = await tx.insert(thing).values({ name }).returning({ id: thing.id });
          // Hold the transaction open so concurrent requests really overlap.
          if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
          return row.id;
        };

      it("reads the Idempotency-Key header and rejects a missing or non-UUID key with 400", async () => {
        const key = crypto.randomUUID();
        expect(readIdempotencyKey(new Request("http://x/", { method: "POST", headers: { "idempotency-key": key } }))).toBe(key);
        for (const headers of [{} as Record<string, string>, { "idempotency-key": "" }, { "idempotency-key": "abc" }, { "idempotency-key": `${key}x` }]) {
          const error = (() => {
            try {
              readIdempotencyKey(new Request("http://x/", { method: "POST", headers }));
            } catch (e) {
              return e;
            }
          })();
          const response = toErrorResponse(error);
          expect(response.status).toBe(400);
          expect((await body(response)).error.code).toBe("idempotency_key");
        }
      });

      it("returns the first result on a sequential repeat and creates nothing new", async () => {
        const key = crypto.randomUUID();
        const first = await withIdempotency("thing.create", key, createThing("A"));
        const second = await withIdempotency("thing.create", key, createThing("B"));
        expect(first.created).toBe(true);
        expect(second).toEqual({ id: first.id, created: false });
        expect(await count()).toBe(1);
        expect((await sql`select name from e0s6_thing`)[0].name).toBe("A");
      });

      it("creates exactly one row when two requests with the same key arrive at once", async () => {
        const key = crypto.randomUUID();
        const results = await Promise.all([
          withIdempotency("thing.create", key, createThing("A", 300)),
          withIdempotency("thing.create", key, createThing("B", 300)),
        ]);
        expect(results[0].id).toBe(results[1].id);
        expect(results.filter((r) => r.created)).toHaveLength(1);
        expect(await count()).toBe(1);
      });

      it("creates separate rows for different keys", async () => {
        const a = await withIdempotency("thing.create", crypto.randomUUID(), createThing("A"));
        const b = await withIdempotency("thing.create", crypto.randomUUID(), createThing("B"));
        expect(a.id).not.toBe(b.id);
        expect(await count()).toBe(2);
      });

      it("forgets the key when the create fails, so a retry can succeed", async () => {
        const key = crypto.randomUUID();
        await expect(
          withIdempotency("thing.create", key, async () => {
            throw new ApiError(409, "conflict", "Sudah ada.");
          }),
        ).rejects.toBeInstanceOf(ApiError);
        const retry = await withIdempotency("thing.create", key, createThing("A"));
        expect(retry.created).toBe(true);
        expect(await count()).toBe(1);
      });

      it("treats a key older than 24 hours as expired and purges it", async () => {
        const key = crypto.randomUUID();
        const old = await withIdempotency("thing.create", key, createThing("A"));
        const stale = crypto.randomUUID();
        await sql`insert into idempotency_key (key, scope, result_id, created_at)
                  values (${stale}, 'thing.create', ${old.id}, now() - interval '25 hours')`;
        await sql`update idempotency_key set created_at = now() - interval '25 hours' where key = ${key}`;
        const again = await withIdempotency("thing.create", key, createThing("B"));
        expect(again.created).toBe(true);
        expect(again.id).not.toBe(old.id);
        expect((await sql`select count(*)::int as n from idempotency_key where key = ${stale}`)[0].n).toBe(0);
      });

      it("rejects a key reused for a different kind of create with 422", async () => {
        const key = crypto.randomUUID();
        await withIdempotency("thing.create", key, createThing("A"));
        const error = await withIdempotency("other.create", key, createThing("B")).catch((e) => e);
        const response = toErrorResponse(error);
        expect(response.status).toBe(422);
        expect((await body(response)).error.code).toBe("idempotency_key_reused");
        expect(await count()).toBe(1);
      });
    });

    describe("criterion 5: updates carry the version the client loaded", () => {
      it("updates when the version matches and increments it", async () => {
        const [row] = await sql`insert into e0s6_thing (name) values ('A') returning id`;
        const updated = await updateWithVersion(thing, row.id, 1, { name: "B" });
        expect(updated.name).toBe("B");
        expect(updated.version).toBe(2);
      });

      it("rejects a stale version with 409 and the exact message, saving nothing", async () => {
        const [row] = await sql`insert into e0s6_thing (name) values ('A') returning id`;
        await updateWithVersion(thing, row.id, 1, { name: "Tab 1" });
        const error = await updateWithVersion(thing, row.id, 1, { name: "Tab 2" }).catch((e) => e);
        const response = toErrorResponse(error);
        expect(response.status).toBe(409);
        expect(await body(response)).toEqual({
          error: { code: "version_conflict", message: "Data ini sudah diubah. Muat ulang untuk melihat versi terbaru." },
        });
        expect(VERSION_CONFLICT_MESSAGE).toBe("Data ini sudah diubah. Muat ulang untuk melihat versi terbaru.");
        const [current] = await sql`select name, version from e0s6_thing where id = ${row.id}`;
        expect(current).toEqual({ name: "Tab 1", version: 2 });
      });

      it("lets only one of two concurrent updates from the same version win", async () => {
        const [row] = await sql`insert into e0s6_thing (name) values ('A') returning id`;
        const results = await Promise.allSettled([
          updateWithVersion(thing, row.id, 1, { name: "X" }),
          updateWithVersion(thing, row.id, 1, { name: "Y" }),
        ]);
        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
      });

      it("returns 404 when the id does not exist", async () => {
        const error = await updateWithVersion(thing, crypto.randomUUID(), 1, { name: "B" }).catch((e) => e);
        const response = toErrorResponse(error);
        expect(response.status).toBe(404);
        expect((await body(response)).error.code).toBe("not_found");
      });
    });
  });
});
