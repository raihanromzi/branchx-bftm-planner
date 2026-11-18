// E1-S1: the Admin adds, edits, deactivates and reactivates Funding Officers. There is no delete.
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "@/server/auth/password";
import { SESSION_COOKIE, hashSessionToken } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { ApiError } from "@/server/http";
import {
  FUNDING_OFFICER_INACTIVE_MESSAGE,
  FUNDING_OFFICER_NAME_MAX,
  FUNDING_OFFICER_NOT_FOUND_MESSAGE,
  assertAssignableFundingOfficer,
  createFundingOfficerInput,
  updateFundingOfficerInput,
} from "@/server/funding-officers";
import * as listRoute from "@/app/api/funding-officers/route";
import * as itemRoute from "@/app/api/funding-officers/[id]/route";
import * as deactivateRoute from "@/app/api/funding-officers/[id]/deactivate/route";
import * as reactivateRoute from "@/app/api/funding-officers/[id]/reactivate/route";
import { migrateTestDatabase, testDatabaseUrl, truncateAllTables } from "./support/test-db";

const TEST_URL = testDatabaseUrl();
const ORIGIN = "http://localhost:3000";
const MISSING_ID = "00000000-0000-4000-8000-000000000000";
let sql: postgres.Sql;
let token: string;

type Record_ = {
  id: string;
  name: string;
  phone: string;
  active: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};
type ErrorBody = { error: { code: string; message: string; fields?: Record<string, string> } };

async function signedInToken() {
  const [admin] = await sql<{ id: string }[]>`
    insert into admin (email, password_hash)
    values ('admin@contoh.id', ${await hashPassword("kata-sandi-uji-123")}) returning id`;
  const value = randomUUID();
  await sql`
    insert into session (admin_id, token_hash, expires_at)
    values (${admin.id}, ${hashSessionToken(value)}, now() + interval '1 day')`;
  return value;
}

function request(
  path: string,
  method: string,
  { body, headers = {}, auth = true }: { body?: unknown; headers?: Record<string, string>; auth?: boolean } = {},
) {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: {
      host: "localhost:3000",
      "content-type": "application/json",
      ...(auth ? { cookie: `${SESSION_COOKIE}=${token}` } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function create(body: unknown, key: string = randomUUID(), headers: Record<string, string> = {}) {
  return listRoute.POST(
    request("/api/funding-officers", "POST", { body, headers: { "Idempotency-Key": key, ...headers } }),
  );
}

async function createOk(name: string, phone = "0812 3456 7890"): Promise<Record_> {
  const response = await create({ name, phone });
  expect(response.status).toBe(201);
  return (await response.json()) as Record_;
}

async function list(): Promise<Record_[]> {
  const response = await listRoute.GET(request("/api/funding-officers", "GET"));
  expect(response.status).toBe(200);
  return ((await response.json()) as { items: Record_[] }).items;
}

async function patch(id: string, body: unknown, headers: Record<string, string> = {}) {
  return itemRoute.PATCH(request(`/api/funding-officers/${id}`, "PATCH", { body, headers }), ctx(id));
}

async function deactivate(id: string, version: number, headers: Record<string, string> = {}) {
  return deactivateRoute.POST(
    request(`/api/funding-officers/${id}/deactivate`, "POST", { body: { version }, headers }),
    ctx(id),
  );
}

async function reactivate(id: string, version: number, headers: Record<string, string> = {}) {
  return reactivateRoute.POST(
    request(`/api/funding-officers/${id}/reactivate`, "POST", { body: { version }, headers }),
    ctx(id),
  );
}

describe("E1-S1 Funding Officers", () => {
  const originalUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    await migrateTestDatabase(TEST_URL);
    process.env.DATABASE_URL = TEST_URL;
    sql = postgres(TEST_URL, { max: 1, prepare: false, onnotice: () => {} });
  });

  beforeEach(async () => {
    await truncateAllTables(sql);
    token = await signedInToken();
  });

  afterAll(async () => {
    await sql.end();
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
  });

  describe("criterion 1: a Funding Officer has a name (1 to 100 characters), a normalised phone and an active flag", () => {
    it("creates one with 201, trimming the name and storing the phone as +62, active, version 1", async () => {
      const response = await create({ name: "  Rina Kartika  ", phone: "0812-3456-7890" });
      expect(response.status).toBe(201);
      expect(response.headers.get("cache-control")).toContain("no-store");
      const record = (await response.json()) as Record_;
      expect(record).toEqual({
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        name: "Rina Kartika",
        phone: "+6281234567890",
        active: true,
        version: 1,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
      expect(Number.isNaN(Date.parse(record.createdAt))).toBe(false);
      const [row] = await sql`select name, phone, active, version from funding_officer where id = ${record.id}`;
      expect(row).toEqual({ name: "Rina Kartika", phone: "+6281234567890", active: true, version: 1 });
    });

    it("accepts names of 1 and 100 characters and rejects 0 and 101", () => {
      expect(FUNDING_OFFICER_NAME_MAX).toBe(100);
      const phone = "081234567890";
      expect(createFundingOfficerInput.safeParse({ name: "A", phone }).success).toBe(true);
      expect(createFundingOfficerInput.safeParse({ name: "a".repeat(100), phone }).success).toBe(true);
      expect(createFundingOfficerInput.safeParse({ name: "😀".repeat(100), phone }).success).toBe(true);
      expect(createFundingOfficerInput.safeParse({ name: "", phone }).error?.issues[0].message).toBe("Wajib diisi.");
      expect(createFundingOfficerInput.safeParse({ name: "   ", phone }).error?.issues[0].message).toBe("Wajib diisi.");
      expect(createFundingOfficerInput.safeParse({ name: "a".repeat(101), phone }).error?.issues[0].message).toBe(
        "Maksimal 100 karakter.",
      );
    });

    it.each([
      ["081234567890", "+6281234567890"],
      ["0812 3456 7890", "+6281234567890"],
      ["62 812 3456 7890", "+6281234567890"],
      ["+62 812-3456-7890", "+6281234567890"],
    ])("normalises the phone %s to %s", async (phone, expected) => {
      const response = await create({ name: "Agus Setiawan", phone });
      expect(response.status).toBe(201);
      expect(((await response.json()) as Record_).phone).toBe(expected);
    });

    it("answers 400 with one message per field for a missing name, a bad phone and a long name", async () => {
      const missing = await create({});
      expect(missing.status).toBe(400);
      expect(await missing.json()).toEqual({
        error: {
          code: "validation",
          message: "Periksa kembali isian yang ditandai.",
          fields: { name: "Wajib diisi.", phone: "Wajib diisi." },
        },
      });

      for (const phone of ["0812 345 67", "+1 202 555 0123", "0812-ABCD-7890", ""]) {
        const bad = await create({ name: "Dedi Pratama", phone });
        expect(bad.status).toBe(400);
        expect(((await bad.json()) as ErrorBody).error.fields).toEqual({
          phone: "Nomor telepon tidak valid. Contoh: 0812 3456 7890",
        });
      }

      const long = await create({ name: "a".repeat(101), phone: "081234567890" });
      expect(((await long.json()) as ErrorBody).error.fields).toEqual({ name: "Maksimal 100 karakter." });
      expect((await sql`select 1 from funding_officer`).length).toBe(0);
    });

    it("answers 400 invalid_json for a body that is not JSON", async () => {
      const response = await create("{nama");
      expect(response.status).toBe(400);
      expect(((await response.json()) as ErrorBody).error.code).toBe("invalid_json");
    });

    it("ignores an active flag sent on create: a new Funding Officer is always active", async () => {
      const response = await create({ name: "Sari Wulandari", phone: "081234567890", active: false });
      expect(((await response.json()) as Record_).active).toBe(true);
    });

    it("needs an Idempotency-Key; a repeat with the same key answers 200 with the same record and creates nothing", async () => {
      const noKey = await listRoute.POST(
        request("/api/funding-officers", "POST", { body: { name: "Rina Kartika", phone: "081234567890" } }),
      );
      expect(noKey.status).toBe(400);
      expect(((await noKey.json()) as ErrorBody).error.code).toBe("idempotency_key");

      const key = randomUUID();
      const first = await create({ name: "Rina Kartika", phone: "081234567890" }, key);
      const second = await create({ name: "Rina Kartika", phone: "081234567890" }, key);
      expect(first.status).toBe(201);
      expect(second.status).toBe(200);
      expect(await second.json()).toEqual(await first.json());
      expect((await sql`select 1 from funding_officer`).length).toBe(1);
    });

    it("lets a corrected retry with the same key create after a validation failure", async () => {
      const key = randomUUID();
      expect((await create({ name: "", phone: "081234567890" }, key)).status).toBe(400);
      expect((await create({ name: "Rina Kartika", phone: "081234567890" }, key)).status).toBe(201);
    });

    it("GET /:id answers the record, and 404 for an unknown or non-UUID id", async () => {
      const rina = await createOk("Rina Kartika");
      const found = await itemRoute.GET(request(`/api/funding-officers/${rina.id}`, "GET"), ctx(rina.id));
      expect(found.status).toBe(200);
      expect(await found.json()).toEqual(rina);

      for (const id of [MISSING_ID, "bukan-uuid"]) {
        const missing = await itemRoute.GET(request(`/api/funding-officers/${id}`, "GET"), ctx(id));
        expect(missing.status).toBe(404);
        expect(await missing.json()).toEqual({ error: { code: "not_found", message: "Data tidak ditemukan." } });
      }
    });

    it("PATCH /:id changes the name and phone, increments the version and updates updatedAt", async () => {
      const rina = await createOk("Rina Kartika");
      const response = await patch(rina.id, { name: " Rina K. ", phone: "+62 813-1111-2222", version: 1 });
      expect(response.status).toBe(200);
      const updated = (await response.json()) as Record_;
      expect(updated).toMatchObject({ id: rina.id, name: "Rina K.", phone: "+6281311112222", active: true, version: 2 });
      expect(Date.parse(updated.updatedAt)).toBeGreaterThanOrEqual(Date.parse(rina.updatedAt));

      const nameOnly = (await (await patch(rina.id, { name: "Rina Kartika", version: 2 })).json()) as Record_;
      expect(nameOnly).toMatchObject({ name: "Rina Kartika", phone: "+6281311112222", version: 3 });
    });

    it("PATCH /:id answers 409 for a stale version, 404 for an unknown id and 400 for bad input", async () => {
      const rina = await createOk("Rina Kartika");
      await patch(rina.id, { name: "Rina K.", version: 1 });

      const stale = await patch(rina.id, { name: "Rina Lama", version: 1 });
      expect(stale.status).toBe(409);
      expect(await stale.json()).toEqual({
        error: { code: "version_conflict", message: "Data ini sudah diubah. Muat ulang untuk melihat versi terbaru." },
      });
      const [row] = await sql`select name, version from funding_officer where id = ${rina.id}`;
      expect(row).toEqual({ name: "Rina K.", version: 2 });

      expect((await patch(MISSING_ID, { name: "Rina", version: 1 })).status).toBe(404);
      expect((await patch("bukan-uuid", { name: "Rina", version: 1 })).status).toBe(404);

      const noVersion = await patch(rina.id, { name: "Rina" });
      expect(noVersion.status).toBe(400);
      expect(((await noVersion.json()) as ErrorBody).error.fields).toEqual({ version: "Wajib diisi." });

      const bad = await patch(rina.id, { name: "", phone: "123", version: 2 });
      expect(((await bad.json()) as ErrorBody).error.fields).toEqual({
        name: "Wajib diisi.",
        phone: "Nomor telepon tidak valid. Contoh: 0812 3456 7890",
      });
      expect(updateFundingOfficerInput.safeParse({ version: 0 }).success).toBe(false);
    });
  });

  describe("criterion 2: the list returns active Funding Officers first, then inactive ones, each sorted by name", () => {
    it("orders by active, then name case-insensitively", async () => {
      const citra = await createOk("Citra Lestari");
      await createOk("Bayu Nugroho");
      await createOk("agus Setiawan");
      const andi = await createOk("Andi Wijaya");
      await createOk("dedi Pratama");
      await createOk("Eko Saputra");
      await deactivate(citra.id, 1);
      await deactivate(andi.id, 1);

      const items = await list();
      expect(items.map((item) => [item.name, item.active])).toEqual([
        ["agus Setiawan", true],
        ["Bayu Nugroho", true],
        ["dedi Pratama", true],
        ["Eko Saputra", true],
        ["Andi Wijaya", false],
        ["Citra Lestari", false],
      ]);
      expect(Object.keys(items[0]).sort()).toEqual(
        ["active", "createdAt", "id", "name", "phone", "updatedAt", "version"].sort(),
      );
    });

    it("answers an empty list when there are no Funding Officers", async () => {
      expect(await list()).toEqual([]);
    });
  });

  describe("criterion 3: an inactive Funding Officer cannot be assigned to new work", () => {
    it("assertAssignableFundingOfficer passes for an active Funding Officer", async () => {
      const rina = await createOk("Rina Kartika");
      await expect(assertAssignableFundingOfficer(getDb(), rina.id)).resolves.toBeUndefined();
      await getDb().transaction(async (tx) => {
        await expect(assertAssignableFundingOfficer(tx, rina.id)).resolves.toBeUndefined();
      });
    });

    it("throws 422 funding_officer_inactive with the exact message once deactivated", async () => {
      const rina = await createOk("Rina Kartika");
      await deactivate(rina.id, 1);
      const error = await assertAssignableFundingOfficer(getDb(), rina.id).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({
        status: 422,
        code: "funding_officer_inactive",
        message: "Funding Officer ini sudah nonaktif.",
      });
      expect(FUNDING_OFFICER_INACTIVE_MESSAGE).toBe("Funding Officer ini sudah nonaktif.");
    });

    it("throws 422 funding_officer_not_found for an unknown or non-UUID id", async () => {
      for (const id of [MISSING_ID, "bukan-uuid"]) {
        const error = await assertAssignableFundingOfficer(getDb(), id).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ApiError);
        expect(error).toMatchObject({
          status: 422,
          code: "funding_officer_not_found",
          message: "Funding Officer tidak ditemukan.",
        });
      }
      expect(FUNDING_OFFICER_NOT_FOUND_MESSAGE).toBe("Funding Officer tidak ditemukan.");
    });

    it("deactivating answers the record with active false and the version incremented", async () => {
      const rina = await createOk("Rina Kartika");
      const response = await deactivate(rina.id, 1);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ id: rina.id, active: false, version: 2 });
    });

    it("deactivating keeps the name and phone, and an inactive Funding Officer can still be edited", async () => {
      const rina = await createOk("Rina Kartika");
      await deactivate(rina.id, 1);
      const edited = await patch(rina.id, { phone: "081399998888", version: 2 });
      expect(await edited.json()).toMatchObject({ name: "Rina Kartika", phone: "+6281399998888", active: false, version: 3 });
    });

    it("deactivating an already inactive Funding Officer is idempotent: 200 with the record unchanged", async () => {
      const rina = await createOk("Rina Kartika");
      const first = (await (await deactivate(rina.id, 1)).json()) as Record_;
      // A double tap resends the version the client loaded before the first deactivation.
      const again = await deactivate(rina.id, 1);
      expect(again.status).toBe(200);
      expect(await again.json()).toEqual(first);
    });

    it("deactivate answers 409 for a stale version, 404 for an unknown id and 400 without a version", async () => {
      const rina = await createOk("Rina Kartika");
      await patch(rina.id, { name: "Rina K.", version: 1 });
      const stale = await deactivate(rina.id, 1);
      expect(stale.status).toBe(409);
      expect(((await stale.json()) as ErrorBody).error.code).toBe("version_conflict");
      expect((await sql`select active from funding_officer`)[0].active).toBe(true);

      expect((await deactivate(MISSING_ID, 1)).status).toBe(404);
      expect((await deactivate("bukan-uuid", 1)).status).toBe(404);

      const noVersion = await deactivateRoute.POST(
        request(`/api/funding-officers/${rina.id}/deactivate`, "POST", { body: {} }),
        ctx(rina.id),
      );
      expect(noVersion.status).toBe(400);
      expect(((await noVersion.json()) as ErrorBody).error.fields).toEqual({ version: "Wajib diisi." });
    });
  });

  describe("criterion 4: a deactivated Funding Officer can be reactivated", () => {
    it("reactivates, after which it is assignable again and listed with the active ones", async () => {
      const rina = await createOk("Rina Kartika");
      await createOk("Bayu Nugroho");
      await deactivate(rina.id, 1);
      expect((await list()).map((item) => item.name)).toEqual(["Bayu Nugroho", "Rina Kartika"]);

      const response = await reactivate(rina.id, 2);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ id: rina.id, active: true, version: 3 });
      await expect(assertAssignableFundingOfficer(getDb(), rina.id)).resolves.toBeUndefined();
      expect((await list()).map((item) => [item.name, item.active])).toEqual([
        ["Bayu Nugroho", true],
        ["Rina Kartika", true],
      ]);
    });

    it("reactivating an active Funding Officer is idempotent: 200 with the record unchanged", async () => {
      const rina = await createOk("Rina Kartika");
      const response = await reactivate(rina.id, 1);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(rina);
    });

    it("reactivate answers 409 for a stale version and 404 for an unknown id", async () => {
      const rina = await createOk("Rina Kartika");
      await deactivate(rina.id, 1);
      await patch(rina.id, { name: "Rina K.", version: 2 });
      expect((await reactivate(rina.id, 2)).status).toBe(409);
      expect((await reactivate(MISSING_ID, 1)).status).toBe(404);
    });
  });

  describe("criterion 5: there is no endpoint that deletes a Funding Officer (EC22)", () => {
    it("no route under /api/funding-officers exports DELETE", () => {
      const dir = join(process.cwd(), "src", "app", "api", "funding-officers");
      const files = (function walk(path: string): string[] {
        return readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
          entry.isDirectory() ? walk(join(path, entry.name)) : entry.name.startsWith("route.") ? [join(path, entry.name)] : [],
        );
      })(dir);
      expect(files.length).toBe(4);
      for (const route of [listRoute, itemRoute, deactivateRoute, reactivateRoute]) {
        expect("DELETE" in route).toBe(false);
      }
      expect(Object.keys(listRoute).sort()).toEqual(["GET", "POST"]);
      expect(Object.keys(itemRoute).sort()).toEqual(["GET", "PATCH"]);
      expect(Object.keys(deactivateRoute)).toEqual(["POST"]);
      expect(Object.keys(reactivateRoute)).toEqual(["POST"]);
    });
  });

  describe("authorization and Origin", () => {
    it("answers 401 for every handler without a session", async () => {
      const id = MISSING_ID;
      const responses = [
        await listRoute.GET(request("/api/funding-officers", "GET", { auth: false })),
        await listRoute.POST(
          request("/api/funding-officers", "POST", {
            auth: false,
            body: { name: "Rina Kartika", phone: "081234567890" },
            headers: { "Idempotency-Key": randomUUID() },
          }),
        ),
        await itemRoute.GET(request(`/api/funding-officers/${id}`, "GET", { auth: false }), ctx(id)),
        await itemRoute.PATCH(
          request(`/api/funding-officers/${id}`, "PATCH", { auth: false, body: { name: "x", version: 1 } }),
          ctx(id),
        ),
        await deactivateRoute.POST(
          request(`/api/funding-officers/${id}/deactivate`, "POST", { auth: false, body: { version: 1 } }),
          ctx(id),
        ),
        await reactivateRoute.POST(
          request(`/api/funding-officers/${id}/reactivate`, "POST", { auth: false, body: { version: 1 } }),
          ctx(id),
        ),
      ];
      for (const response of responses) {
        expect(response.status).toBe(401);
        expect(((await response.json()) as ErrorBody).error.code).toBe("unauthorized");
      }
      expect((await sql`select 1 from funding_officer`).length).toBe(0);
    });

    it("answers 403 forbidden_origin for every mutation from another origin, and changes nothing", async () => {
      const rina = await createOk("Rina Kartika");
      const evil = { origin: "https://jahat.example" };
      const responses = [
        await create({ name: "Agus Setiawan", phone: "081234567890" }, randomUUID(), evil),
        await patch(rina.id, { name: "Diubah", version: 1 }, evil),
        await deactivate(rina.id, 1, evil),
        await reactivate(rina.id, 1, evil),
      ];
      for (const response of responses) {
        expect(response.status).toBe(403);
        expect(((await response.json()) as ErrorBody).error.code).toBe("forbidden_origin");
      }
      const rows = await sql`select name, active, version from funding_officer`;
      expect(rows).toEqual([{ name: "Rina Kartika", active: true, version: 1 }]);
    });

    it("accepts a same-origin mutation", async () => {
      const response = await create({ name: "Agus Setiawan", phone: "081234567890" }, randomUUID(), { origin: ORIGIN });
      expect(response.status).toBe(201);
    });
  });
});
