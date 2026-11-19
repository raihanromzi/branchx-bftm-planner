// E2-S1: the Admin creates, edits, searches, archives and restores Prospects. There is no delete.
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "@/server/auth/password";
import { SESSION_COOKIE, hashSessionToken } from "@/server/auth/session";
import {
  CREATE_SCOPE,
  LIST_PAGE_SIZE,
  PROSPECT_ARCHIVED_MESSAGE,
  createProspectInput,
  listProspects,
  prospectListQuery,
  prospectNameKey,
  updateProspectInput,
} from "@/server/prospects";
import * as listRoute from "@/app/api/prospects/route";
import * as itemRoute from "@/app/api/prospects/[id]/route";
import * as archiveRoute from "@/app/api/prospects/[id]/archive/route";
import * as restoreRoute from "@/app/api/prospects/[id]/restore/route";
import * as archivePreviewRoute from "@/app/api/prospects/[id]/archive-preview/route";
import { migrateTestDatabase, testDatabaseUrl, truncateAllTables } from "./support/test-db";

const TEST_URL = testDatabaseUrl();
const ORIGIN = "http://localhost:3000";
const MISSING_ID = "00000000-0000-4000-8000-000000000000";
let sql: postgres.Sql;
let token: string;
let rina: Officer;
let agus: Officer;

type Officer = { id: string; name: string };
type FundingOfficerRef = { id: string; name: string; active: boolean };
type Prospect = {
  id: string;
  name: string;
  category: string;
  address: string | null;
  location: { lat: number; lng: number } | null;
  contact: { name: string | null; role: string | null; phone: string | null };
  potentialAccounts: number | null;
  fundingOfficer: FundingOfficerRef;
  note: string | null;
  archived: boolean;
  archivedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};
type Saved = { prospect: Prospect; duplicates: { id: string; name: string }[] };
type Row = {
  id: string;
  name: string;
  category: string;
  fundingOfficer: FundingOfficerRef;
  hasLocation: boolean;
  potentialAccounts: number | null;
  archived: boolean;
  openPipeline: null;
};
type Page = { items: Row[]; page: number; pageSize: number; total: number };
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

async function insertOfficer(name: string, active = true): Promise<Officer> {
  const [row] = await sql<Officer[]>`
    insert into funding_officer (name, phone, active) values (${name}, '+6281234567890', ${active})
    returning id, name`;
  return row;
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

function valid(overrides: Record<string, unknown> = {}) {
  return { name: "SDN 3 Cibinong", category: "sekolah", fundingOfficerId: rina.id, ...overrides };
}

async function create(body: unknown, key: string = randomUUID(), headers: Record<string, string> = {}) {
  return listRoute.POST(request("/api/prospects", "POST", { body, headers: { "Idempotency-Key": key, ...headers } }));
}

async function createOk(overrides: Record<string, unknown> = {}): Promise<Saved> {
  const response = await create(valid(overrides));
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
  return (await response.json()) as Saved;
}

async function errorOf(response: Response) {
  return ((await response.json()) as ErrorBody).error;
}

async function list(query = ""): Promise<Page> {
  const response = await listRoute.GET(request(`/api/prospects${query}`, "GET"));
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
  return (await response.json()) as Page;
}

async function get(id: string) {
  return itemRoute.GET(request(`/api/prospects/${id}`, "GET"), ctx(id));
}

async function patch(id: string, body: unknown, headers: Record<string, string> = {}) {
  return itemRoute.PATCH(request(`/api/prospects/${id}`, "PATCH", { body, headers }), ctx(id));
}

async function archive(id: string, version: number, headers: Record<string, string> = {}) {
  return archiveRoute.POST(request(`/api/prospects/${id}/archive`, "POST", { body: { version }, headers }), ctx(id));
}

async function restore(id: string, version: number, headers: Record<string, string> = {}) {
  return restoreRoute.POST(request(`/api/prospects/${id}/restore`, "POST", { body: { version }, headers }), ctx(id));
}

function fieldsOf(schema: { safeParse: (v: unknown) => { error?: { issues: { path: PropertyKey[]; message: string }[] } } }, value: unknown) {
  const issues = schema.safeParse(value).error?.issues ?? [];
  return Object.fromEntries(issues.map((issue) => [issue.path.map(String).join("."), issue.message]));
}

describe("E2-S1 Prospects", () => {
  const originalUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    await migrateTestDatabase(TEST_URL);
    process.env.DATABASE_URL = TEST_URL;
    sql = postgres(TEST_URL, { max: 1, prepare: false, onnotice: () => {} });
  });

  beforeEach(async () => {
    await truncateAllTables(sql);
    token = await signedInToken();
    rina = await insertOfficer("Rina Kartika");
    agus = await insertOfficer("Agus Setiawan");
  });

  afterAll(async () => {
    await sql.end();
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
  });

  describe("criterion 1: a Prospect has its fields, a required active Funding Officer, and no account-holder field (EC7, EC9)", () => {
    it("creates one with every field, answering 201 { prospect, duplicates } with no-store", async () => {
      const response = await create({
        name: "  SDN 3 Cibinong  ",
        category: "sekolah",
        fundingOfficerId: rina.id,
        address: " Jl. Raya Bogor Km 43 ",
        location: { lat: -6.4817, lng: 106.854 },
        contact: { name: "Ibu Sri Wahyuni", role: "Kepala Sekolah", phone: "0812-3456-7890" },
        potentialAccounts: 350,
        note: "Kunjungan 18-11-2026 10.30, minta brosur.",
      });
      expect(response.status).toBe(201);
      expect(response.headers.get("cache-control")).toContain("no-store");
      const body = (await response.json()) as Saved;
      expect(body).toEqual({
        prospect: {
          id: expect.stringMatching(/^[0-9a-f-]{36}$/),
          name: "SDN 3 Cibinong",
          category: "sekolah",
          address: "Jl. Raya Bogor Km 43",
          location: { lat: -6.4817, lng: 106.854 },
          contact: { name: "Ibu Sri Wahyuni", role: "Kepala Sekolah", phone: "+6281234567890" },
          potentialAccounts: 350,
          fundingOfficer: { id: rina.id, name: "Rina Kartika", active: true },
          note: "Kunjungan 18-11-2026 10.30, minta brosur.",
          archived: false,
          archivedAt: null,
          version: 1,
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
        },
        duplicates: [],
      });
      const [row] = await sql`select name, name_key from prospect`;
      expect(row).toEqual({ name: "SDN 3 Cibinong", name_key: "sdn 3 cibinong" });
    });

    it("needs only name and Funding Officer; Category and the other optional fields are stored as null", async () => {
      const response = await create({ name: "SDN 3 Cibinong", fundingOfficerId: rina.id });
      expect(response.status).toBe(201);
      const { prospect } = (await response.json()) as Saved;
      expect(prospect.category).toBeNull();
      expect((await createOk({ category: null })).prospect.category).toBeNull();
      expect(createProspectInput.parse({ name: "A", fundingOfficerId: MISSING_ID }).category).toBeNull();
      expect(prospect).toMatchObject({
        address: null,
        location: null,
        contact: { name: null, role: null, phone: null },
        potentialAccounts: null,
        note: null,
      });
      const blanks = await createOk({ address: " ", note: "", contact: { name: "", role: null, phone: " " }, location: null });
      expect(blanks.prospect).toMatchObject({ address: null, note: null, contact: { name: null, role: null, phone: null } });
    });

    it("has no column for an account holder, and drops any such field sent", async () => {
      const columns = (
        await sql<{ column_name: string }[]>`
          select column_name from information_schema.columns where table_name = 'prospect' order by column_name`
      ).map((row) => row.column_name);
      expect(columns).toEqual(
        [
          "address", "archived_at", "category", "contact_name", "contact_phone", "contact_role", "created_at",
          "funding_officer_id", "id", "lat", "lng", "name", "name_key", "note", "potential_accounts", "updated_at", "version",
        ].sort(),
      );
      const { prospect } = await createOk({
        nik: "3201234567890001",
        accountNumber: "1234567890",
        contact: { name: "Pak Budi", nik: "3201234567890001", balance: 5000000 },
      });
      expect(Object.keys(prospect)).not.toContain("nik");
      expect(prospect.contact).toEqual({ name: "Pak Budi", role: null, phone: null });
    });

    it("accepts names of 1 and 150 characters and rejects 0, blank and 151 with the exact messages (EC7, EC9)", () => {
      const base = { category: "sekolah", fundingOfficerId: MISSING_ID };
      expect(createProspectInput.safeParse({ ...base, name: "A" }).success).toBe(true);
      expect(createProspectInput.safeParse({ ...base, name: "a".repeat(150) }).success).toBe(true);
      expect(createProspectInput.safeParse({ ...base, name: "😀".repeat(150) }).success).toBe(true);
      expect(fieldsOf(createProspectInput, { ...base, name: "" })).toEqual({ name: "Nama Prospect wajib diisi." });
      expect(fieldsOf(createProspectInput, { ...base, name: "   " })).toEqual({ name: "Nama Prospect wajib diisi." });
      expect(fieldsOf(createProspectInput, base)).toEqual({ name: "Nama Prospect wajib diisi." });
      expect(fieldsOf(createProspectInput, { ...base, name: "a".repeat(151) })).toEqual({ name: "Maksimal 150 karakter." });
    });

    it("answers 400 with per-field messages for a missing name and Funding Officer (Category is optional), and saves nothing", async () => {
      const response = await create({});
      expect(response.status).toBe(400);
      expect(await errorOf(response)).toEqual({
        code: "validation",
        message: "Periksa kembali isian yang ditandai.",
        fields: { name: "Nama Prospect wajib diisi.", fundingOfficerId: "Wajib diisi." },
      });
      const long = await create(valid({ name: "a".repeat(151) }));
      expect((await errorOf(long)).fields).toEqual({ name: "Maksimal 150 karakter." });
      expect((await sql`select 1 from prospect`).length).toBe(0);
    });

    it.each(["sekolah", "pasar", "perusahaan", "instansi", "komunitas", "lainnya"])("accepts the Category %s", async (category) => {
      const { prospect } = await createOk({ category });
      expect(prospect.category).toBe(category);
    });

    it.each(["Sekolah", "rumah", "", 1])("rejects the Category %j", async (category) => {
      const response = await create(valid({ category }));
      expect(response.status).toBe(400);
      expect((await errorOf(response)).fields).toEqual({ category: "Isian tidak valid." });
    });

    it("normalises the contact phone, and rejects an invalid one under contact.phone", async () => {
      const { prospect } = await createOk({ contact: { phone: "+62 812.3456.7890" } });
      expect(prospect.contact.phone).toBe("+6281234567890");
      const bad = await create(valid({ contact: { phone: "0812 345" } }));
      expect((await errorOf(bad)).fields).toEqual({ "contact.phone": "Nomor telepon tidak valid. Contoh: 0812 3456 7890" });
    });

    it("rejects a NIK or account number in the name, note, address and Contact Person, and long contact text", async () => {
      const guard = "Jangan tulis NIK atau nomor rekening nasabah.";
      const response = await create(
        valid({
          name: "Toko 3201 2345 6789 0001",
          note: "Nasabah 3201234567890001",
          address: "Rek 1234567890",
          contact: { name: "Pak 3201.2345.6789.0001", role: "a".repeat(101) },
        }),
      );
      expect(response.status).toBe(400);
      expect((await errorOf(response)).fields).toEqual({
        name: guard,
        note: guard,
        address: guard,
        "contact.name": guard,
        "contact.role": "Maksimal 100 karakter.",
      });
      const longNote = await create(valid({ note: "a".repeat(501) }));
      expect((await errorOf(longNote)).fields).toEqual({ note: "Maksimal 500 karakter." });
      expect((await createOk({ note: "😀".repeat(500) })).prospect.note).toHaveLength(1000);
    });

    it("refuses an inactive or unknown Funding Officer with 422 and the exact messages, and saves nothing", async () => {
      const gone = await insertOfficer("Dedi Pratama", false);
      const inactive = await create(valid({ fundingOfficerId: gone.id }));
      expect(inactive.status).toBe(422);
      expect(await errorOf(inactive)).toEqual({ code: "funding_officer_inactive", message: "Funding Officer ini sudah nonaktif." });
      for (const id of [MISSING_ID, "bukan-uuid"]) {
        const unknown = await create(valid({ fundingOfficerId: id }));
        expect(unknown.status).toBe(422);
        expect(await errorOf(unknown)).toEqual({ code: "funding_officer_not_found", message: "Funding Officer tidak ditemukan." });
      }
      expect((await sql`select 1 from prospect`).length).toBe(0);
    });

    it("needs an Idempotency-Key; a repeat with the same key answers 200 with the same body and creates nothing (EC15)", async () => {
      const noKey = await listRoute.POST(request("/api/prospects", "POST", { body: valid() }));
      expect(noKey.status).toBe(400);
      expect((await errorOf(noKey)).code).toBe("idempotency_key");

      const key = randomUUID();
      const first = await create(valid(), key);
      const second = await create(valid(), key);
      expect(first.status).toBe(201);
      expect(second.status).toBe(200);
      expect(await second.json()).toEqual(await first.json());
      expect((await sql`select 1 from prospect`).length).toBe(1);
      const [row] = await sql`select scope from idempotency_key`;
      expect(row.scope).toBe(CREATE_SCOPE);
      expect(CREATE_SCOPE).toBe("prospect.create");
    });

    it("lets a retry with the same key create after a 422 for an inactive Funding Officer", async () => {
      const gone = await insertOfficer("Dedi Pratama", false);
      const key = randomUUID();
      expect((await create(valid({ fundingOfficerId: gone.id }), key)).status).toBe(422);
      expect((await create(valid(), key)).status).toBe(201);
    });

    it("answers 400 invalid_json for a body that is not JSON", async () => {
      const response = await create("{nama");
      expect(response.status).toBe(400);
      expect((await errorOf(response)).code).toBe("invalid_json");
    });
  });

  describe("criterion 2: Potential Accounts accepts only integers from 0 to 100,000 (EC10)", () => {
    it.each([0, 100000, 350])("accepts %j", async (potentialAccounts) => {
      expect((await createOk({ potentialAccounts })).prospect.potentialAccounts).toBe(potentialAccounts);
    });

    it.each([-1, 100001, 1.5, "10", true])("rejects %j with the exact message", async (potentialAccounts) => {
      const response = await create(valid({ potentialAccounts }));
      expect(response.status).toBe(400);
      expect((await errorOf(response)).fields).toEqual({
        potentialAccounts: "Potensi rekening harus bilangan bulat 0 sampai 100.000.",
      });
    });

    it("is optional: missing or null is stored as null", async () => {
      expect((await createOk({ potentialAccounts: null })).prospect.potentialAccounts).toBeNull();
    });

    it("the database refuses an out-of-range value too", async () => {
      await expect(
        sql`insert into prospect (name, name_key, category, funding_officer_id, potential_accounts)
            values ('X', 'x', 'pasar', ${rina.id}, 100001)`,
      ).rejects.toThrow(/prospect_potential_accounts_range/);
    });
  });

  describe("criterion 3: a location outside Indonesia is rejected with \"Lokasi di luar Indonesia.\" (EC13)", () => {
    it.each([
      [-11, 95],
      [6, 141],
      [-6.4817, 106.854],
      [0, 120],
    ])("accepts lat %d, lng %d (the box is inclusive)", async (lat, lng) => {
      expect((await createOk({ location: { lat, lng } })).prospect.location).toEqual({ lat, lng });
    });

    it.each([
      [-11.0001, 106],
      [6.0001, 106],
      [-6, 94.9999],
      [-6, 141.0001],
      [1.3521, 103.8198 - 10],
      [40.7128, -74.006],
    ])("rejects lat %d, lng %d", async (lat, lng) => {
      const response = await create(valid({ location: { lat, lng } }));
      expect(response.status).toBe(400);
      expect((await errorOf(response)).fields).toEqual({ location: "Lokasi di luar Indonesia." });
    });

    it("needs both latitude and longitude, as numbers", async () => {
      const latOnly = await create(valid({ location: { lat: -6.4 } }));
      expect((await errorOf(latOnly)).fields).toEqual({ "location.lng": "Wajib diisi." });
      const lngOnly = await create(valid({ location: { lng: 106.8 } }));
      expect((await errorOf(lngOnly)).fields).toEqual({ "location.lat": "Wajib diisi." });
      const text = await create(valid({ location: { lat: "-6.4", lng: 106.8 } }));
      expect((await errorOf(text)).fields).toEqual({ "location.lat": "Isian tidak valid." });
      expect((await sql`select 1 from prospect`).length).toBe(0);
    });

    it("the database refuses half a location or one outside the box", async () => {
      await expect(
        sql`insert into prospect (name, name_key, category, funding_officer_id, lat)
            values ('X', 'x', 'pasar', ${rina.id}, -6)`,
      ).rejects.toThrow(/prospect_location_pair/);
      await expect(
        sql`insert into prospect (name, name_key, category, funding_officer_id, lat, lng)
            values ('X', 'x', 'pasar', ${rina.id}, 40, -74)`,
      ).rejects.toThrow(/prospect_location_indonesia/);
    });
  });

  describe("criterion 4: the list is paged at 50, sorted by name, with search and filters on the server (EC6)", () => {
    it("answers { items, page, pageSize: 50, total } with the row shape, openPipeline null", async () => {
      const { prospect } = await createOk({ location: { lat: -6.4, lng: 106.8 }, potentialAccounts: 350 });
      const page = await list();
      expect(LIST_PAGE_SIZE).toBe(50);
      expect(page).toEqual({
        items: [
          {
            id: prospect.id,
            name: "SDN 3 Cibinong",
            category: "sekolah",
            fundingOfficer: { id: rina.id, name: "Rina Kartika", active: true },
            hasLocation: true,
            potentialAccounts: 350,
            archived: false,
            openPipeline: null,
          },
        ],
        page: 1,
        pageSize: 50,
        total: 1,
      });
    });

    it("answers an empty first page when there are no Prospects", async () => {
      expect(await list()).toEqual({ items: [], page: 1, pageSize: 50, total: 0 });
    });

    it("pages 51 Prospects into 50 and 1, and a page past the end is empty", async () => {
      await sql`
        insert into prospect (name, name_key, category, funding_officer_id)
        select 'Prospect ' || lpad(i::text, 3, '0'), 'prospect ' || lpad(i::text, 3, '0'), 'pasar', ${rina.id}
        from generate_series(1, 51) as i`;
      const first = await list();
      expect(first.items).toHaveLength(50);
      expect(first.total).toBe(51);
      expect(first.items[0].name).toBe("Prospect 001");
      const second = await list("?page=2");
      expect(second).toMatchObject({ page: 2, pageSize: 50, total: 51 });
      expect(second.items.map((item) => item.name)).toEqual(["Prospect 051"]);
      expect((await list("?page=3")).items).toEqual([]);
    });

    it("sorts by name ignoring case and repeated spaces", async () => {
      for (const name of ["pasar Kramat Jati", "SDN 3 Cibinong", "Kantor  Kecamatan", "alfa Mart", "Bengkel Jaya"]) {
        await createOk({ name });
      }
      expect((await list()).items.map((item) => item.name)).toEqual([
        "alfa Mart",
        "Bengkel Jaya",
        "Kantor  Kecamatan",
        "pasar Kramat Jati",
        "SDN 3 Cibinong",
      ]);
    });

    it("searches by name, ignoring case and repeated spaces, anywhere in the name", async () => {
      for (const name of ["SDN 3 Cibinong", "SDN 5 Cibinong", "Pasar Cibinong", "PT Sinar Logistik"]) {
        await createOk({ name });
      }
      expect((await list("?q=cibinong")).items.map((item) => item.name)).toEqual([
        "Pasar Cibinong",
        "SDN 3 Cibinong",
        "SDN 5 Cibinong",
      ]);
      expect((await list("?q=" + encodeURIComponent("  sdn   3 "))).items.map((item) => item.name)).toEqual(["SDN 3 Cibinong"]);
      expect((await list("?q=CIBINONG")).total).toBe(3);
      expect((await list("?q=tidak-ada")).items).toEqual([]);
      expect((await list("?q=")).total).toBe(4);
    });

    it("treats % and _ in the search as literal characters", async () => {
      for (const name of ["Diskon 50% Pasar", "Pasar_Baru", "Pasar Baru"]) await createOk({ name });
      expect((await list("?q=" + encodeURIComponent("%"))).items.map((item) => item.name)).toEqual(["Diskon 50% Pasar"]);
      expect((await list("?q=" + encodeURIComponent("_"))).items.map((item) => item.name)).toEqual(["Pasar_Baru"]);
      expect((await list("?q=" + encodeURIComponent("r_b"))).items.map((item) => item.name)).toEqual(["Pasar_Baru"]);
      expect((await list("?q=" + encodeURIComponent("\\"))).items).toEqual([]);
    });

    it("filters by Category", async () => {
      await createOk({ name: "SDN 3 Cibinong", category: "sekolah" });
      await createOk({ name: "Pasar Anyar", category: "pasar" });
      await createOk({ name: "Paguyuban Tanpa Kategori", category: null });
      expect((await list("?category=pasar")).items.map((item) => item.name)).toEqual(["Pasar Anyar"]);
      expect((await list("?category=komunitas")).items).toEqual([]);
      const all = await list();
      expect(all.total).toBe(3);
      expect(all.items.find((item) => item.name === "Paguyuban Tanpa Kategori")?.category).toBeNull();
    });

    it("filters by Funding Officer", async () => {
      await createOk({ name: "SDN 3 Cibinong" });
      await createOk({ name: "Pasar Anyar", fundingOfficerId: agus.id });
      const page = await list(`?fundingOfficerId=${agus.id}`);
      expect(page.items.map((item) => [item.name, item.fundingOfficer.name])).toEqual([["Pasar Anyar", "Agus Setiawan"]]);
    });

    it("filters to Prospects with no location", async () => {
      await createOk({ name: "SDN 3 Cibinong", location: { lat: -6.4, lng: 106.8 } });
      await createOk({ name: "Pasar Anyar" });
      const page = await list("?noLocation=1");
      expect(page.items.map((item) => [item.name, item.hasLocation])).toEqual([["Pasar Anyar", false]]);
      expect((await list("?noLocation=0")).total).toBe(2);
    });

    it("combines search and filters", async () => {
      await createOk({ name: "SDN 3 Cibinong", category: "sekolah" });
      await createOk({ name: "SDN 5 Cibinong", category: "sekolah", fundingOfficerId: agus.id });
      await createOk({ name: "Pasar Cibinong", category: "pasar", fundingOfficerId: agus.id });
      const page = await list(`?q=cibinong&category=sekolah&fundingOfficerId=${agus.id}&noLocation=1`);
      expect(page.items.map((item) => item.name)).toEqual(["SDN 5 Cibinong"]);
      expect(page.total).toBe(1);
    });

    it("answers 400 for invalid query values", async () => {
      for (const [query, field] of [
        ["?page=0", "page"],
        ["?page=abc", "page"],
        ["?page=1.5", "page"],
        ["?category=rumah", "category"],
        ["?fundingOfficerId=bukan-uuid", "fundingOfficerId"],
        ["?archived=yes", "archived"],
        ["?noLocation=2", "noLocation"],
        [`?q=${"a".repeat(151)}`, "q"],
      ]) {
        const response = await listRoute.GET(request(`/api/prospects${query}`, "GET"));
        expect(response.status, query).toBe(400);
        expect(Object.keys((await errorOf(response)).fields ?? {}), query).toEqual([field]);
      }
      expect(prospectListQuery.parse({})).toEqual({ archived: false, noLocation: false, page: 1 });
    });

    it("shows a deactivated Funding Officer on the row with active false", async () => {
      await createOk();
      await sql`update funding_officer set active = false where id = ${rina.id}`;
      expect((await list()).items[0].fundingOfficer).toEqual({ id: rina.id, name: "Rina Kartika", active: false });
    });

    it("stays under 500 ms with 2,000 Prospects (median of 3 runs, each query shape)", async () => {
      const officers = [rina.id, agus.id, (await insertOfficer("Citra Lestari")).id];
      await sql`
        insert into prospect (name, name_key, category, funding_officer_id, lat, lng, potential_accounts, archived_at)
        select
          n, lower(n),
          (array['sekolah','pasar','perusahaan','instansi','komunitas','lainnya'])[1 + i % 6]::prospect_category,
          (array[${officers[0]}, ${officers[1]}, ${officers[2]}]::uuid[])[1 + i % 3],
          case when i % 4 = 0 then null else -6 - (i % 100) / 1000.0 end,
          case when i % 4 = 0 then null else 106 + (i % 100) / 1000.0 end,
          i % 500,
          case when i % 10 = 0 then now() else null end
        from (select i, (array['SDN ','Pasar ','PT ','Kantor ','Paguyuban '])[1 + i % 5] || 'Cibinong ' || i as n
              from generate_series(1, 2000) as i) as s`;
      expect(Number((await sql`select count(*) from prospect`)[0].count)).toBe(2000);
      await sql`analyze prospect`;

      const shapes = [
        {},
        { q: "cibinong 1" },
        { q: "sdn", category: "sekolah" as const, fundingOfficerId: agus.id, noLocation: true },
        { archived: true, page: 40 },
      ];
      const timings: Record<string, number> = {};
      for (const shape of shapes) {
        const query = prospectListQuery.parse(Object.fromEntries(Object.entries(shape).map(([k, v]) => [k, v === true ? "1" : String(v)])));
        const runs: number[] = [];
        for (let run = 0; run < 3; run++) {
          const start = performance.now();
          const page = await listProspects(query);
          runs.push(performance.now() - start);
          expect(page.pageSize).toBe(50);
        }
        const median = runs.sort((a, b) => a - b)[1];
        timings[JSON.stringify(shape)] = Math.round(median);
        expect(median, JSON.stringify(shape)).toBeLessThan(500);
      }
      console.info("[E2-S1] list median ms with 2,000 Prospects:", timings);

      const start = performance.now();
      const page = await list("?q=cibinong&page=2");
      expect(performance.now() - start).toBeLessThan(500);
      expect(page.total).toBe(1800);
      expect(page.items).toHaveLength(50);
    });
  });

  describe("criterion 5: a matching name still saves, and the response lists the matching Prospects (EC14)", () => {
    it("saves a second Prospect whose name differs only in case and spaces, and lists the first", async () => {
      const first = await createOk({ name: "SDN 3 Cibinong" });
      const response = await create(valid({ name: "  sdn   3  CIBINONG " }));
      expect(response.status).toBe(201);
      const body = (await response.json()) as Saved;
      expect(body.prospect.name).toBe("sdn   3  CIBINONG");
      expect(body.duplicates).toEqual([{ id: first.prospect.id, name: "SDN 3 Cibinong" }]);
      expect((await sql`select 1 from prospect`).length).toBe(2);
      expect(prospectNameKey("  sdn \t  3  CIBINONG ")).toBe("sdn 3 cibinong");
    });

    it("lists every other match, never the Prospect itself, and not archived ones", async () => {
      const a = await createOk({ name: "SDN 3 Cibinong" });
      const b = await createOk({ name: "SDN 3 CIBINONG" });
      const archived = await createOk({ name: "sdn 3 cibinong" });
      await archive(archived.prospect.id, 1);
      await createOk({ name: "SDN 3 Cibinong Timur" });
      const third = await createOk({ name: "Sdn 3 Cibinong" });
      expect(third.duplicates.map((item) => item.id).sort()).toEqual([a.prospect.id, b.prospect.id].sort());
      expect(third.duplicates.map((item) => item.id)).not.toContain(third.prospect.id);
    });

    it("a repeat of the same create key recomputes the duplicates", async () => {
      const key = randomUUID();
      const first = (await (await create(valid(), key)).json()) as Saved;
      expect(first.duplicates).toEqual([]);
      const other = await createOk();
      const again = (await (await create(valid(), key)).json()) as Saved;
      expect(again.prospect.id).toBe(first.prospect.id);
      expect(again.duplicates).toEqual([{ id: other.prospect.id, name: "SDN 3 Cibinong" }]);
    });

    it("renaming to a matching name saves and lists the match; other edits list none", async () => {
      const school = await createOk({ name: "SDN 3 Cibinong" });
      const market = await createOk({ name: "Pasar Anyar" });
      const renamed = await patch(market.prospect.id, { name: "SDN  3 cibinong", version: 1 });
      expect(renamed.status).toBe(200);
      const body = (await renamed.json()) as Saved;
      expect(body.prospect).toMatchObject({ name: "SDN  3 cibinong", version: 2 });
      expect(body.duplicates).toEqual([{ id: school.prospect.id, name: "SDN 3 Cibinong" }]);

      const noteOnly = (await (await patch(market.prospect.id, { note: "Buka Senin", version: 2 })).json()) as Saved;
      expect(noteOnly.duplicates).toEqual([]);
      const [row] = await sql`select name_key from prospect where id = ${market.prospect.id}`;
      expect(row.name_key).toBe("sdn 3 cibinong");
    });
  });

  describe("criterion 6: changing a Prospect's Funding Officer changes only the Prospect (EC26)", () => {
    it("reassigns to another active Funding Officer and changes nothing else", async () => {
      const { prospect } = await createOk({ note: "Catatan", potentialAccounts: 10 });
      const other = await createOk({ name: "Pasar Anyar" });
      const officersBefore = await sql`select * from funding_officer order by id`;
      const response = await patch(prospect.id, { fundingOfficerId: agus.id, version: 1 });
      expect(response.status).toBe(200);
      const body = (await response.json()) as Saved;
      expect(body.prospect).toEqual({
        ...prospect,
        fundingOfficer: { id: agus.id, name: "Agus Setiawan", active: true },
        version: 2,
        updatedAt: expect.any(String),
      });
      expect(body.duplicates).toEqual([]);
      expect(await sql`select * from funding_officer order by id`).toEqual(officersBefore);
      expect(await (await get(other.prospect.id)).json()).toEqual(other.prospect);
    });

    it("refuses reassignment to an inactive or unknown Funding Officer with the exact messages, changing nothing", async () => {
      const { prospect } = await createOk();
      const gone = await insertOfficer("Dedi Pratama", false);
      const inactive = await patch(prospect.id, { fundingOfficerId: gone.id, version: 1 });
      expect(inactive.status).toBe(422);
      expect(await errorOf(inactive)).toEqual({ code: "funding_officer_inactive", message: "Funding Officer ini sudah nonaktif." });
      const unknown = await patch(prospect.id, { fundingOfficerId: MISSING_ID, version: 1 });
      expect(unknown.status).toBe(422);
      expect(await errorOf(unknown)).toEqual({ code: "funding_officer_not_found", message: "Funding Officer tidak ditemukan." });
      const [row] = await sql`select funding_officer_id, version from prospect`;
      expect(row).toEqual({ funding_officer_id: rina.id, version: 1 });
    });

    it("does not check an unchanged Funding Officer: a Prospect whose Funding Officer was deactivated can still be edited (EC20)", async () => {
      const { prospect } = await createOk();
      await sql`update funding_officer set active = false where id = ${rina.id}`;
      const noteOnly = await patch(prospect.id, { note: "Masih jalan", version: 1 });
      expect(noteOnly.status).toBe(200);
      const same = await patch(prospect.id, { fundingOfficerId: rina.id, version: 2 });
      expect(same.status).toBe(200);
      expect(((await same.json()) as Saved).prospect.fundingOfficer).toEqual({ id: rina.id, name: "Rina Kartika", active: false });
    });
  });

  describe("editing", () => {
    it("PATCH changes only the fields sent; null clears an optional field, and location: null removes the location", async () => {
      const { prospect } = await createOk({
        address: "Jl. Raya",
        location: { lat: -6.4, lng: 106.8 },
        contact: { name: "Ibu Sri", role: "Kepala Sekolah", phone: "081234567890" },
        potentialAccounts: 350,
        note: "Catatan",
      });
      const response = await patch(prospect.id, { category: "instansi", location: null, potentialAccounts: null, address: "", version: 1 });
      expect(response.status).toBe(200);
      const updated = ((await response.json()) as Saved).prospect;
      expect(updated).toMatchObject({
        name: "SDN 3 Cibinong",
        category: "instansi",
        address: null,
        location: null,
        potentialAccounts: null,
        note: "Catatan",
        contact: { name: "Ibu Sri", role: "Kepala Sekolah", phone: "+6281234567890" },
        version: 2,
      });
      const noCategory = await patch(prospect.id, { category: null, version: 2 });
      expect(noCategory.status).toBe(200);
      expect(((await noCategory.json()) as Saved).prospect.category).toBeNull();
      expect((await (await get(prospect.id)).json()).category).toBeNull();
      const contact = ((await (await patch(prospect.id, { contact: { name: "Pak Budi" }, version: 3 })).json()) as Saved).prospect;
      expect(contact.contact).toEqual({ name: "Pak Budi", role: null, phone: null });
      const cleared = ((await (await patch(prospect.id, { contact: null, version: 4 })).json()) as Saved).prospect;
      expect(cleared.contact).toEqual({ name: null, role: null, phone: null });
      const located = ((await (await patch(prospect.id, { location: { lat: 6, lng: 141 }, version: 5 })).json()) as Saved).prospect;
      expect(located.location).toEqual({ lat: 6, lng: 141 });
    });

    it("PATCH validates like create", async () => {
      const { prospect } = await createOk();
      const response = await patch(prospect.id, {
        name: "",
        category: "rumah",
        location: { lat: 40, lng: -74 },
        potentialAccounts: -1,
        version: 1,
      });
      expect(response.status).toBe(400);
      expect((await errorOf(response)).fields).toEqual({
        name: "Nama Prospect wajib diisi.",
        category: "Isian tidak valid.",
        location: "Lokasi di luar Indonesia.",
        potentialAccounts: "Potensi rekening harus bilangan bulat 0 sampai 100.000.",
      });
      expect(fieldsOf(updateProspectInput, { name: null, version: 1 })).toEqual({ name: "Isian tidak valid." });
    });

    it("PATCH answers 409 for a stale version, 404 for an unknown id and 400 without a version", async () => {
      const { prospect } = await createOk();
      await patch(prospect.id, { note: "Satu", version: 1 });
      const stale = await patch(prospect.id, { note: "Dua", version: 1 });
      expect(stale.status).toBe(409);
      expect(await errorOf(stale)).toEqual({
        code: "version_conflict",
        message: "Data ini sudah diubah. Muat ulang untuk melihat versi terbaru.",
      });
      expect((await sql`select note, version from prospect`)[0]).toEqual({ note: "Satu", version: 2 });
      expect((await patch(MISSING_ID, { note: "x", version: 1 })).status).toBe(404);
      expect((await patch("bukan-uuid", { note: "x", version: 1 })).status).toBe(404);
      const noVersion = await patch(prospect.id, { note: "x" });
      expect((await errorOf(noVersion)).fields).toEqual({ version: "Wajib diisi." });
    });
  });

  describe("criterion 7: archived Prospects leave the default list, can be fetched and restored, and nothing deletes a Prospect (EC22, EC40)", () => {
    it("archives: the record answers archived true with archivedAt, version + 1", async () => {
      const { prospect } = await createOk();
      const response = await archive(prospect.id, 1);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("no-store");
      const archived = (await response.json()) as Prospect;
      expect(archived).toMatchObject({ id: prospect.id, archived: true, version: 2 });
      expect(Number.isNaN(Date.parse(archived.archivedAt ?? ""))).toBe(false);
    });

    it("leaves archived Prospects out of the default list, and archived=1 includes them, labelled", async () => {
      const school = await createOk({ name: "SDN 3 Cibinong" });
      await createOk({ name: "Pasar Anyar" });
      await archive(school.prospect.id, 1);
      const defaults = await list();
      expect(defaults.items.map((item) => item.name)).toEqual(["Pasar Anyar"]);
      expect(defaults.total).toBe(1);
      expect((await list("?archived=0")).total).toBe(1);
      const withArchived = await list("?archived=1");
      expect(withArchived.items.map((item) => [item.name, item.archived])).toEqual([
        ["Pasar Anyar", false],
        ["SDN 3 Cibinong", true],
      ]);
      expect((await list("?archived=1&q=sdn")).items.map((item) => item.name)).toEqual(["SDN 3 Cibinong"]);
    });

    it("fetches an archived Prospect by id with archived: true (not 404)", async () => {
      const { prospect } = await createOk();
      await archive(prospect.id, 1);
      const response = await get(prospect.id);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(await response.json()).toMatchObject({ id: prospect.id, name: "SDN 3 Cibinong", archived: true, version: 2 });
    });

    it("GET /:id answers the full record, and 404 for an unknown or non-UUID id", async () => {
      const { prospect } = await createOk({ contact: { name: "Ibu Sri" }, location: { lat: -6.4, lng: 106.8 } });
      expect(await (await get(prospect.id)).json()).toEqual(prospect);
      for (const id of [MISSING_ID, "bukan-uuid"]) {
        const missing = await get(id);
        expect(missing.status).toBe(404);
        expect(await missing.json()).toEqual({ error: { code: "not_found", message: "Data tidak ditemukan." } });
      }
    });

    it("restores: back in the default list with archived false and archivedAt null", async () => {
      const { prospect } = await createOk();
      await archive(prospect.id, 1);
      const response = await restore(prospect.id, 2);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ id: prospect.id, archived: false, archivedAt: null, version: 3 });
      expect((await list()).items.map((item) => item.id)).toEqual([prospect.id]);
    });

    it("archive and restore are idempotent: already in that state answers 200 with the record unchanged", async () => {
      const { prospect } = await createOk();
      const restored = await restore(prospect.id, 1);
      expect(restored.status).toBe(200);
      expect(await restored.json()).toEqual(prospect);
      const first = await (await archive(prospect.id, 1)).json();
      const again = await archive(prospect.id, 1);
      expect(again.status).toBe(200);
      expect(await again.json()).toEqual(first);
    });

    it("archive and restore answer 409 for a stale version, 404 for an unknown id, 400 without a version", async () => {
      const { prospect } = await createOk();
      await patch(prospect.id, { note: "x", version: 1 });
      expect((await archive(prospect.id, 1)).status).toBe(409);
      expect((await sql`select archived_at from prospect`)[0].archived_at).toBeNull();
      await archive(prospect.id, 2);
      await sql`update prospect set version = version + 1`;
      expect((await restore(prospect.id, 3)).status).toBe(409);
      for (const id of [MISSING_ID, "bukan-uuid"]) {
        expect((await archive(id, 1)).status).toBe(404);
        expect((await restore(id, 1)).status).toBe(404);
      }
      const noVersion = await archiveRoute.POST(request(`/api/prospects/${prospect.id}/archive`, "POST", { body: {} }), ctx(prospect.id));
      expect((await errorOf(noVersion)).fields).toEqual({ version: "Wajib diisi." });
    });

    it("refuses edits to an archived Prospect with 422 prospect_archived, until it is restored", async () => {
      const { prospect } = await createOk();
      await archive(prospect.id, 1);
      const refused = await patch(prospect.id, { note: "Ubah", version: 2 });
      expect(refused.status).toBe(422);
      expect(await errorOf(refused)).toEqual({
        code: "prospect_archived",
        message: "Prospect ini diarsipkan. Pulihkan dulu untuk mengubahnya.",
      });
      expect(PROSPECT_ARCHIVED_MESSAGE).toBe("Prospect ini diarsipkan. Pulihkan dulu untuk mengubahnya.");
      expect((await sql`select note, version from prospect`)[0]).toEqual({ note: null, version: 2 });
      await restore(prospect.id, 2);
      expect((await patch(prospect.id, { note: "Ubah", version: 3 })).status).toBe(200);
    });

    it("no route under /api/prospects exports DELETE", () => {
      const dir = join(process.cwd(), "src", "app", "api", "prospects");
      const files = (function walk(path: string): string[] {
        return readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
          entry.isDirectory() ? walk(join(path, entry.name)) : entry.name.startsWith("route.") ? [join(path, entry.name)] : [],
        );
      })(dir);
      // archive-preview was added by E4-S1 (EC19).
      expect(files.length).toBe(5);
      for (const route of [listRoute, itemRoute, archiveRoute, restoreRoute, archivePreviewRoute]) expect("DELETE" in route).toBe(false);
      expect(Object.keys(listRoute).sort()).toEqual(["GET", "POST"]);
      expect(Object.keys(itemRoute).sort()).toEqual(["GET", "PATCH"]);
      expect(Object.keys(archiveRoute)).toEqual(["POST"]);
      expect(Object.keys(restoreRoute)).toEqual(["POST"]);
      expect(Object.keys(archivePreviewRoute)).toEqual(["GET"]);
    });

    it("the database refuses to delete a Funding Officer who still has Prospects", async () => {
      await createOk();
      await expect(sql`delete from funding_officer where id = ${rina.id}`).rejects.toThrow(/foreign key/);
    });
  });

  describe("authorization and Origin", () => {
    it("answers 401 for every handler without a session, and saves nothing", async () => {
      const id = MISSING_ID;
      const responses = [
        await listRoute.GET(request("/api/prospects", "GET", { auth: false })),
        await listRoute.POST(
          request("/api/prospects", "POST", { auth: false, body: valid(), headers: { "Idempotency-Key": randomUUID() } }),
        ),
        await itemRoute.GET(request(`/api/prospects/${id}`, "GET", { auth: false }), ctx(id)),
        await itemRoute.PATCH(request(`/api/prospects/${id}`, "PATCH", { auth: false, body: { version: 1 } }), ctx(id)),
        await archiveRoute.POST(request(`/api/prospects/${id}/archive`, "POST", { auth: false, body: { version: 1 } }), ctx(id)),
        await restoreRoute.POST(request(`/api/prospects/${id}/restore`, "POST", { auth: false, body: { version: 1 } }), ctx(id)),
      ];
      for (const response of responses) {
        expect(response.status).toBe(401);
        expect((await errorOf(response)).code).toBe("unauthorized");
      }
      expect((await sql`select 1 from prospect`).length).toBe(0);
    });

    it("answers 403 forbidden_origin for every mutation from another origin, and changes nothing", async () => {
      const { prospect } = await createOk();
      const evil = { origin: "https://jahat.example" };
      const responses = [
        await create(valid({ name: "Pasar Anyar" }), randomUUID(), evil),
        await patch(prospect.id, { note: "Diubah", version: 1 }, evil),
        await archive(prospect.id, 1, evil),
        await restore(prospect.id, 1, evil),
      ];
      for (const response of responses) {
        expect(response.status).toBe(403);
        expect((await errorOf(response)).code).toBe("forbidden_origin");
      }
      expect(await sql`select name, note, archived_at, version from prospect`).toEqual([
        { name: "SDN 3 Cibinong", note: null, archived_at: null, version: 1 },
      ]);
    });

    it("accepts a same-origin mutation", async () => {
      expect((await create(valid(), randomUUID(), { origin: ORIGIN })).status).toBe(201);
    });
  });
});
