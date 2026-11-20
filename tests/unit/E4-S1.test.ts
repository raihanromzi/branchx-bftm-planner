// E4-S1: the Admin schedules and cancels Activities for the Funding Officers. Also: archiving a
// Prospect cancels its future Scheduled Activities, and the archive preview counts them (EC19).
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "@/server/auth/password";
import { SESSION_COOKIE, hashSessionToken } from "@/server/auth/session";
import { CREATE_SCOPE, cancelActivity, getActivity, listActivities } from "@/server/activities";
import * as activitiesRoute from "@/app/api/activities/route";
import * as activityRoute from "@/app/api/activities/[id]/route";
import * as cancelRoute from "@/app/api/activities/[id]/cancel/route";
import * as archiveRoute from "@/app/api/prospects/[id]/archive/route";
import * as previewRoute from "@/app/api/prospects/[id]/archive-preview/route";
import { migrateTestDatabase, testDatabaseUrl, truncateAllTables } from "./support/test-db";

const TEST_URL = testDatabaseUrl();
const ORIGIN = "http://localhost:3000";
const MISSING_ID = "00000000-0000-4000-8000-000000000000";
const GUARD = "Jangan tulis NIK atau nomor rekening nasabah.";
const HOUR = 3_600_000;
let sql: postgres.Sql;
let token: string;
let rina: Officer;
let agus: Officer;

type Officer = { id: string; name: string };
type ErrorBody = { error: { code: string; message: string; fields?: Record<string, string> } };
type Activity = {
  id: string;
  prospect: { id: string; name: string; archived: boolean };
  fundingOfficer: { id: string; name: string; active: boolean };
  pipeline: { id: string; outcome: string | null; currentStage: { position: number; name: string } } | null;
  startsAt: string;
  purpose: string;
  status: "scheduled" | "done" | "cancelled";
  overdue: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};

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

async function insertProspect(name: string, { officer = rina, archived = false } = {}): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into prospect (name, name_key, funding_officer_id, archived_at)
    values (${name}, ${name.toLowerCase()}, ${officer.id}, ${archived ? sql`now()` : null})
    returning id`;
  return row.id;
}

/** A Pipeline with one Stage "Presentasi" at position 1, with the given Outcome. */
async function insertPipeline(prospectId: string, outcome: "won" | "lost" | "on_hold" | null = null): Promise<string> {
  const [template] = await sql<{ id: string }[]>`
    insert into pipeline_template (name, name_key) values (${`T ${randomUUID()}`}, ${randomUUID()}) returning id`;
  const won = outcome === "won";
  const [row] = await sql<{ id: string }[]>`
    insert into pipeline (prospect_id, template_id, funding_officer_id, outcome, accounts_opened, won_on, lost_reason, closed_at)
    values (${prospectId}, ${template.id}, ${rina.id}, ${outcome}, ${won ? 10 : null}, ${won ? "2026-11-01" : null},
            ${outcome === "lost" ? "Tidak berminat" : null}, ${won || outcome === "lost" ? sql`now()` : null})
    returning id`;
  await sql`insert into pipeline_stage (pipeline_id, position, name) values (${row.id}, 1, 'Presentasi')`;
  return row.id;
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

async function errorOf(response: Response) {
  return ((await response.json()) as ErrorBody).error;
}

/** An ISO time `hours` from now. */
const inHours = (hours: number) => new Date(Date.now() + hours * HOUR).toISOString();

function create(body: Record<string, unknown>, key: string = randomUUID(), headers: Record<string, string> = {}) {
  return activitiesRoute.POST(request("/api/activities", "POST", { body, headers: { "Idempotency-Key": key, ...headers } }));
}

async function createOk(body: Record<string, unknown>): Promise<Activity> {
  const response = await create({ fundingOfficerId: rina.id, startsAt: inHours(24), purpose: "Presentasi tabungan pelajar", ...body });
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
  return (await response.json()) as Activity;
}

function get(id: string) {
  return activityRoute.GET(request(`/api/activities/${id}`, "GET"), ctx(id));
}

function cancel(id: string, version: unknown, headers: Record<string, string> = {}) {
  return cancelRoute.POST(request(`/api/activities/${id}/cancel`, "POST", { body: { version }, headers }), ctx(id));
}

async function list(query: string): Promise<Response> {
  return activitiesRoute.GET(request(`/api/activities${query}`, "GET"));
}

async function listOk(query: string): Promise<Activity[]> {
  const response = await list(query);
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
  return ((await response.json()) as { items: Activity[] }).items;
}

async function prospectVersion(id: string): Promise<number> {
  return (await sql<{ version: number }[]>`select version from prospect where id = ${id}`)[0].version;
}

function archive(id: string, version: number) {
  return archiveRoute.POST(request(`/api/prospects/${id}/archive`, "POST", { body: { version } }), ctx(id));
}

function preview(id: string, auth = true) {
  return previewRoute.GET(request(`/api/prospects/${id}/archive-preview`, "GET", { auth }), ctx(id));
}

describe("E4-S1 Activities", () => {
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

  describe("criterion 1: an Activity has a Prospect (not archived), an active Funding Officer, a UTC time, an optional open Pipeline of the same Prospect, and a purpose", () => {
    it("answers 201 with the full record, stores the time in UTC, and a repeat of the key answers 200 with the same record", async () => {
      const prospectId = await insertProspect("SDN 3 Cibinong");
      const pipelineId = await insertPipeline(prospectId);
      const key = randomUUID();
      const body = {
        prospectId,
        fundingOfficerId: agus.id,
        startsAt: "2099-11-20T09:30:00+07:00",
        pipelineId,
        purpose: "  Presentasi tabungan pelajar  ",
      };
      const response = await create(body, key);
      expect(response.status).toBe(201);
      expect(response.headers.get("cache-control")).toContain("no-store");
      const activity = (await response.json()) as Activity;
      expect(activity).toEqual({
        id: expect.any(String),
        prospect: { id: prospectId, name: "SDN 3 Cibinong", archived: false },
        fundingOfficer: { id: agus.id, name: "Agus Setiawan", active: true },
        pipeline: { id: pipelineId, outcome: null, currentStage: { position: 1, name: "Presentasi" } },
        startsAt: "2099-11-20T02:30:00.000Z",
        purpose: "Presentasi tabungan pelajar",
        status: "scheduled",
        overdue: false,
        version: 1,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
      const [row] = await sql`select to_char(starts_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as utc from activity`;
      expect(row.utc).toBe("2099-11-20 02:30");

      const repeat = await create(body, key);
      expect(repeat.status).toBe(200);
      expect(await repeat.json()).toEqual(activity);
      expect((await sql`select count(*)::int as n from activity`)[0].n).toBe(1);
      expect((await sql`select scope from idempotency_key`)[0].scope).toBe(CREATE_SCOPE);

      const fetched = await get(activity.id);
      expect(fetched.status).toBe(200);
      expect(await fetched.json()).toEqual(activity);
    });

    it("works without a Pipeline (missing, null or blank)", async () => {
      const prospectId = await insertProspect("Pasar Anyar");
      for (const pipelineId of [undefined, null, ""]) {
        expect((await createOk({ prospectId, pipelineId })).pipeline).toBeNull();
      }
    });

    it("refuses an archived or unknown Prospect with 422", async () => {
      const archivedId = await insertProspect("Arsip", { archived: true });
      const archived = await create({ prospectId: archivedId, fundingOfficerId: rina.id, startsAt: inHours(1), purpose: "Kunjungan" });
      expect(archived.status).toBe(422);
      expect(await errorOf(archived)).toEqual({
        code: "prospect_archived",
        message: "Prospect ini diarsipkan. Pulihkan dulu untuk mengubahnya.",
      });
      for (const prospectId of [MISSING_ID, "bukan-uuid"]) {
        const missing = await create({ prospectId, fundingOfficerId: rina.id, startsAt: inHours(1), purpose: "Kunjungan" });
        expect(missing.status).toBe(422);
        expect((await errorOf(missing)).code).toBe("prospect_not_found");
      }
      expect((await sql`select count(*)::int as n from activity`)[0].n).toBe(0);
    });

    it("refuses an inactive or unknown Funding Officer with 422, and the key can be reused after a fix", async () => {
      const prospectId = await insertProspect("SDN 3 Cibinong");
      const budi = await insertOfficer("Budi", false);
      const key = randomUUID();
      const inactive = await create({ prospectId, fundingOfficerId: budi.id, startsAt: inHours(1), purpose: "Kunjungan" }, key);
      expect(inactive.status).toBe(422);
      expect(await errorOf(inactive)).toEqual({ code: "funding_officer_inactive", message: "Funding Officer ini sudah nonaktif." });
      const unknown = await create({ prospectId, fundingOfficerId: MISSING_ID, startsAt: inHours(1), purpose: "Kunjungan" });
      expect((await errorOf(unknown)).code).toBe("funding_officer_not_found");
      const fixed = await create({ prospectId, fundingOfficerId: rina.id, startsAt: inHours(1), purpose: "Kunjungan" }, key);
      expect(fixed.status).toBe(201);
    });

    it("refuses a Pipeline of another Prospect, a closed or On Hold one, or an unknown one with 422 pipeline_not_linkable", async () => {
      const prospectId = await insertProspect("SDN 3 Cibinong");
      const otherId = await insertProspect("Pasar Anyar");
      const others = await insertPipeline(otherId);
      const won = await insertPipeline(prospectId, "won");
      const lost = await insertPipeline(prospectId, "lost");
      const onHold = await insertPipeline(prospectId, "on_hold");
      for (const pipelineId of [others, won, lost, onHold, MISSING_ID, "bukan-uuid"]) {
        const response = await create({ prospectId, fundingOfficerId: rina.id, startsAt: inHours(1), purpose: "Kunjungan", pipelineId });
        expect(response.status, pipelineId).toBe(422);
        expect(await errorOf(response)).toEqual({
          code: "pipeline_not_linkable",
          message: "Pipeline harus Pipeline berjalan milik Prospect ini.",
        });
      }
      expect((await sql`select count(*)::int as n from activity`)[0].n).toBe(0);
    });

    it("validates the body: required fields, the time with a zone, and the purpose with the E0-S6 free-text rules", async () => {
      const prospectId = await insertProspect("SDN 3 Cibinong");
      const empty = await create({});
      expect(empty.status).toBe(400);
      expect((await errorOf(empty)).fields).toEqual({
        prospectId: "Wajib diisi.",
        fundingOfficerId: "Wajib diisi.",
        startsAt: "Wajib diisi.",
        purpose: "Wajib diisi.",
      });
      const base = { prospectId, fundingOfficerId: rina.id, startsAt: inHours(1), purpose: "Kunjungan" };
      const cases: [Record<string, unknown>, string, string][] = [
        [{ startsAt: "2026-11-20" }, "startsAt", "Tanggal dan jam tidak valid."],
        [{ startsAt: "2026-11-20T09:00:00" }, "startsAt", "Tanggal dan jam tidak valid."],
        [{ startsAt: "besok" }, "startsAt", "Tanggal dan jam tidak valid."],
        [{ startsAt: 1795042680092 }, "startsAt", "Tanggal dan jam tidak valid."],
        [{ purpose: "   " }, "purpose", "Wajib diisi."],
        [{ purpose: "x".repeat(501) }, "purpose", "Maksimal 500 karakter."],
        [{ purpose: "NIK 3201234567890001" }, "purpose", GUARD],
      ];
      for (const [patch, field, message] of cases) {
        const response = await create({ ...base, ...patch });
        expect(response.status, JSON.stringify(patch)).toBe(400);
        expect((await errorOf(response)).fields?.[field]).toBe(message);
      }
      expect((await createOk({ prospectId, purpose: "x".repeat(500) })).purpose).toHaveLength(500);
    });

    it("needs a session, the same origin and an Idempotency-Key", async () => {
      const prospectId = await insertProspect("SDN 3 Cibinong");
      const body = { prospectId, fundingOfficerId: rina.id, startsAt: inHours(1), purpose: "Kunjungan" };
      const signedOut = await activitiesRoute.POST(
        request("/api/activities", "POST", { body, auth: false, headers: { "Idempotency-Key": randomUUID() } }),
      );
      expect(signedOut.status).toBe(401);
      expect((await create(body, randomUUID(), { origin: "https://jahat.example" })).status).toBe(403);
      const noKey = await activitiesRoute.POST(request("/api/activities", "POST", { body }));
      expect(noKey.status).toBe(400);
      expect((await errorOf(noKey)).code).toBe("idempotency_key");
      expect((await activitiesRoute.GET(request("/api/activities?from=2026-11-01&to=2026-11-07", "GET", { auth: false }))).status).toBe(401);
      expect((await activityRoute.GET(request(`/api/activities/${MISSING_ID}`, "GET", { auth: false }), ctx(MISSING_ID))).status).toBe(401);
      expect(
        (await cancelRoute.POST(request(`/api/activities/${MISSING_ID}/cancel`, "POST", { body: { version: 1 }, auth: false }), ctx(MISSING_ID))).status,
      ).toBe(401);
      expect((await preview(MISSING_ID, false)).status).toBe(401);
    });

    it("GET /:id answers 404 for an unknown or non-UUID id", async () => {
      for (const id of [MISSING_ID, "bukan-uuid"]) {
        const response = await get(id);
        expect(response.status).toBe(404);
        expect((await errorOf(response)).code).toBe("not_found");
      }
    });

    it("stores no customer data: unknown keys are dropped and the table has only the planned columns (ADR 0001)", async () => {
      const prospectId = await insertProspect("SDN 3 Cibinong");
      const activity = await createOk({ prospectId, nasabah: "Budi", nik: "3201234567890001" });
      expect(Object.keys(activity)).not.toContain("nasabah");
      const columns = await sql<{ column_name: string }[]>`
        select column_name from information_schema.columns where table_name = 'activity' order by column_name`;
      expect(columns.map((column) => column.column_name)).toEqual([
        "created_at", "funding_officer_id", "id", "pipeline_id", "prospect_id", "purpose", "starts_at", "status", "updated_at", "version",
      ]);
    });
  });

  describe("criterion 2: an Activity in the past can be created and is Overdue from the moment it is saved (EC28, EC30)", () => {
    it("creates it as Scheduled with overdue: true", async () => {
      const prospectId = await insertProspect("SDN 3 Cibinong");
      const past = await createOk({ prospectId, startsAt: inHours(-3) });
      expect(past).toMatchObject({ status: "scheduled", overdue: true });
      expect((await (await get(past.id)).json()) as Activity).toMatchObject({ overdue: true });
    });

    it("a future Activity becomes Overdue once its time passes, and a cancelled one never is", async () => {
      const prospectId = await insertProspect("SDN 3 Cibinong");
      const future = await createOk({ prospectId, startsAt: inHours(2) });
      expect(future.overdue).toBe(false);
      expect((await getActivity(future.id, { now: new Date(Date.now() + 3 * HOUR) })).overdue).toBe(true);
      const cancelled = await cancelActivity(future.id, { version: 1 });
      expect(cancelled.overdue).toBe(false);
      expect((await getActivity(future.id, { now: new Date(Date.now() + 3 * HOUR) })).overdue).toBe(false);
    });
  });

  describe("criterion 3: Scheduled → Cancelled; Done and Cancelled are final (EC27)", () => {
    it("cancels a Scheduled Activity: 200 with status cancelled and version + 1, also an overdue one", async () => {
      const prospectId = await insertProspect("SDN 3 Cibinong");
      for (const startsAt of [inHours(5), inHours(-5)]) {
        const activity = await createOk({ prospectId, startsAt });
        const response = await cancel(activity.id, 1);
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toContain("no-store");
        expect(await response.json()).toMatchObject({ id: activity.id, status: "cancelled", overdue: false, version: 2 });
      }
    });

    it("refuses to cancel a Cancelled or Done Activity with 422 invalid_transition, whatever the version", async () => {
      const prospectId = await insertProspect("SDN 3 Cibinong");
      const cancelled = await createOk({ prospectId });
      await cancel(cancelled.id, 1);
      const done = await createOk({ prospectId });
      // Done is set only by a Check-in (E4-S3); the database stands in for it here.
      await sql`update activity set status = 'done', version = version + 1 where id = ${done.id}`;
      for (const [id, label] of [[cancelled.id, "Dibatalkan"], [done.id, "Selesai"]]) {
        for (const version of [1, 2]) {
          const response = await cancel(id, version);
          expect(response.status).toBe(422);
          expect(await errorOf(response)).toEqual({
            code: "invalid_transition",
            message: `Kegiatan ini sudah ${label}. Statusnya tidak bisa diubah.`,
          });
        }
      }
      expect((await sql`select status, version from activity where id = ${cancelled.id}`)[0]).toEqual({ status: "cancelled", version: 2 });
    });

    it("answers 409 for a stale version, 404 for an unknown id, 400 without a version, 403 cross-origin", async () => {
      const prospectId = await insertProspect("SDN 3 Cibinong");
      const activity = await createOk({ prospectId });
      await sql`update activity set version = 2`;
      const stale = await cancel(activity.id, 1);
      expect(stale.status).toBe(409);
      expect((await errorOf(stale)).code).toBe("version_conflict");
      expect((await sql`select status from activity`)[0].status).toBe("scheduled");
      for (const id of [MISSING_ID, "bukan-uuid"]) expect((await cancel(id, 1)).status).toBe(404);
      const noVersion = await cancel(activity.id, undefined);
      expect(noVersion.status).toBe(400);
      expect((await errorOf(noVersion)).fields).toEqual({ version: "Wajib diisi." });
      expect((await cancel(activity.id, 2, { origin: "https://jahat.example" })).status).toBe(403);
    });

    it("the API offers no other status change: no PATCH or PUT on an Activity, and the database refuses unknown statuses", async () => {
      expect(Object.keys(activityRoute)).toEqual(["GET"]);
      expect(Object.keys(cancelRoute)).toEqual(["POST"]);
      const prospectId = await insertProspect("SDN 3 Cibinong");
      await createOk({ prospectId });
      await expect(sql`update activity set status = 'postponed'`).rejects.toThrow(/invalid input value for enum/);
    });
  });

  describe("criterion 4: the list filters by date range and Funding Officer, in time order, with an overdue flag (EC8, EC30)", () => {
    it("returns every Activity of the WIB days, in time order, with no page limit", async () => {
      const prospectId = await insertProspect("SDN 3 Cibinong");
      // 2099-11-19 in WIB runs from 2099-11-18T17:00Z to 2099-11-19T17:00Z.
      await createOk({ prospectId, startsAt: "2099-11-18T16:59:00Z", purpose: "Sebelum" });
      await createOk({ prospectId, startsAt: "2099-11-19T17:00:00Z", purpose: "Sesudah" });
      const times: string[] = [];
      for (let i = 39; i >= 0; i--) {
        const startsAt = new Date(Date.UTC(2099, 10, 18, 17, 0) + i * 30 * 60_000).toISOString();
        times.push(startsAt);
        await createOk({ prospectId, startsAt, fundingOfficerId: i % 2 ? rina.id : agus.id, purpose: `Kunjungan ${i}` });
      }
      const items = await listOk("?from=2099-11-19&to=2099-11-19");
      expect(items).toHaveLength(40);
      expect(items.map((item) => item.startsAt)).toEqual([...times].sort());
      expect(items[0].startsAt).toBe("2099-11-18T17:00:00.000Z");
      expect(items.every((item) => item.overdue === false)).toBe(true);
      expect(await listOk("?from=2099-11-18&to=2099-11-20")).toHaveLength(42);
    });

    it("filters by Funding Officer", async () => {
      const prospectId = await insertProspect("SDN 3 Cibinong");
      await createOk({ prospectId, startsAt: "2099-11-19T02:00:00Z", fundingOfficerId: rina.id });
      await createOk({ prospectId, startsAt: "2099-11-19T03:00:00Z", fundingOfficerId: agus.id });
      const items = await listOk(`?from=2099-11-19&to=2099-11-19&fundingOfficerId=${agus.id}`);
      expect(items.map((item) => item.fundingOfficer.name)).toEqual(["Agus Setiawan"]);
      expect(await listOk(`?from=2099-11-19&to=2099-11-19&fundingOfficerId=${MISSING_ID}`)).toEqual([]);
    });

    it("BUG-4: lists one Prospect's Activities without a date range, newest first, at most 100", async () => {
      const prospectId = await insertProspect("SDN 3 Cibinong");
      const other = await insertProspect("SMP 1 Bogor");
      await createOk({ prospectId, startsAt: "2099-11-19T02:00:00Z", purpose: "Nanti" });
      await createOk({ prospectId, startsAt: inHours(-48), purpose: "Lalu" });
      await createOk({ prospectId: other, startsAt: "2099-11-19T03:00:00Z" });
      const items = await listOk(`?prospectId=${prospectId}`);
      expect(items.map((item) => item.purpose)).toEqual(["Nanti", "Lalu"]);
      expect(items.map((item) => item.overdue)).toEqual([false, true]);
      // Combines with a date range and a Funding Officer.
      expect(await listOk(`?prospectId=${prospectId}&from=2099-11-19&to=2099-11-19`)).toHaveLength(1);
      expect(await listOk(`?prospectId=${prospectId}&fundingOfficerId=${agus.id}`)).toEqual([]);
      for (let i = 0; i < 100; i++) await createOk({ prospectId: other, startsAt: inHours(i + 1) });
      expect(await listOk(`?prospectId=${other}`)).toHaveLength(100);
      const half = await list(`?prospectId=${prospectId}&from=2099-11-19`);
      expect(half.status).toBe(400);
      expect((await errorOf(half)).fields?.to).toBe("Wajib diisi.");
      const bad = await list("?prospectId=sdn3");
      expect(bad.status).toBe(400);
      expect((await errorOf(bad)).fields?.prospectId).toBe("Isian tidak valid.");
    });

    it("BUG-5: a Prospect's Activities page without losing any, and upcoming and history are separate lists", async () => {
      const prospectId = await insertProspect("SDN 3 Cibinong");
      const other = await insertProspect("SMP 1 Bogor");
      // The oldest Activity is an Overdue Scheduled one, older than 100 newer Scheduled ones.
      const overdue = await createOk({ prospectId, startsAt: inHours(-24 * 30), purpose: "Terlambat lama" });
      for (let i = 0; i < 101; i++) await createOk({ prospectId, startsAt: inHours(i + 1), purpose: `Nanti ${i}` });
      // Finished work: 3 Cancelled and 1 Done.
      for (let i = 0; i < 3; i++) {
        const made = await createOk({ prospectId, startsAt: inHours(-2 - i), purpose: `Batal ${i}` });
        await cancel(made.id, made.version);
      }
      await createOk({ prospectId: other, startsAt: inHours(5), purpose: "Milik lain" });
      const done = await createOk({ prospectId, startsAt: inHours(-48), purpose: "Selesai" });
      await sql`update activity set status = 'done' where id = ${done.id}`;

      const page = async (query: string) => {
        const response = await list(`?prospectId=${prospectId}${query}`);
        expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
        return (await response.json()) as { items: Activity[]; hasMore: boolean };
      };

      // Upcoming: Scheduled only, the Overdue one first, 100 per page, then the rest.
      const up1 = await page("&view=upcoming");
      expect(up1.items).toHaveLength(100);
      expect(up1.hasMore).toBe(true);
      expect(up1.items[0].id).toBe(overdue.id);
      expect(up1.items[0].overdue).toBe(true);
      expect(up1.items.every((item) => item.status === "scheduled")).toBe(true);
      const up2 = await page(`&view=upcoming&cursor=${up1.items.at(-1)!.id}`);
      expect(up2.items).toHaveLength(2);
      expect(up2.hasMore).toBe(false);
      const upIds = [...up1.items, ...up2.items].map((item) => item.id);
      expect(new Set(upIds).size).toBe(102);
      expect(upIds).toContain(overdue.id);

      // History: Done and Cancelled only, newest first.
      const history = await page("&view=history");
      expect(history.items.map((item) => item.purpose)).toEqual(["Batal 0", "Batal 1", "Batal 2", "Selesai"]);
      expect(history.hasMore).toBe(false);

      // No view: every status, newest first; the last page reaches the oldest, so nothing is cut silently.
      const all1 = await page("");
      const all2 = await page(`&cursor=${all1.items.at(-1)!.id}`);
      expect(all1.hasMore).toBe(true);
      expect(all1.items).toHaveLength(100);
      expect(all2.hasMore).toBe(false);
      expect([...all1.items, ...all2.items]).toHaveLength(106);
      expect(all2.items.at(-1)?.id).toBe(overdue.id);

      // The Funding Officer filter still applies to a Prospect's list (BUG-4).
      expect((await page(`&fundingOfficerId=${agus.id}`)).items).toEqual([]);
      expect((await page(`&view=history&fundingOfficerId=${rina.id}`)).items).toHaveLength(4);

      // A cursor at the last history row returns an empty next page, not an error.
      expect(await page(`&view=history&cursor=${history.items.at(-1)!.id}`)).toEqual({ items: [], hasMore: false });
    });

    it("BUG-5: cursor paging does not skip an unseen Scheduled Activity when an earlier row is cancelled", async () => {
      const prospectId = await insertProspect("SDN 3 Cibinong");
      const startsAt = inHours(24);
      for (let i = 0; i < 102; i++) await createOk({ prospectId, startsAt, purpose: `Kunjungan ${i}` });

      const response1 = await list(`?prospectId=${prospectId}&view=upcoming`);
      expect(response1.status).toBe(200);
      const first = (await response1.json()) as { items: Activity[]; hasMore: boolean };
      expect(first.items).toHaveLength(100);
      expect(first.hasMore).toBe(true);

      await cancel(first.items[0].id, first.items[0].version);
      const cursor = first.items.at(-1)?.id;
      const response2 = await list(`?prospectId=${prospectId}&view=upcoming&cursor=${cursor}`);
      expect(response2.status).toBe(200);
      const second = (await response2.json()) as { items: Activity[]; hasMore: boolean };
      expect(second.items).toHaveLength(2);
      expect(second.hasMore).toBe(false);
      expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(102);
    });

    it("BUG-5: rejects a bad view or cursor, and refuses them without a Prospect or with a range", async () => {
      const prospectId = await insertProspect("SDN 3 Cibinong");
      const other = await insertProspect("SDN 4 Cibinong");
      const otherActivity = await createOk({ prospectId: other, startsAt: inHours(1), purpose: "Lain" });
      for (const query of [
        `?prospectId=${prospectId}&view=semua`,
        `?prospectId=${prospectId}&cursor=tidak-valid`,
        `?prospectId=${prospectId}&cursor=${MISSING_ID}`,
        `?prospectId=${prospectId}&cursor=${otherActivity.id}`,
      ]) {
        const response = await list(query);
        expect(response.status, query).toBe(400);
      }
      expect(((await errorOf(await list(`?prospectId=${prospectId}&view=semua`))).fields ?? {}).view).toBe("Isian tidak valid.");
      // `view` and `cursor` are for one Prospect's list: not with a date range, and not alone.
      const ranged = await list(`?prospectId=${prospectId}&from=2099-11-19&to=2099-11-19&view=upcoming`);
      expect(ranged.status).toBe(400);
      expect((await errorOf(ranged)).fields?.view).toBe("Isian tidak valid.");
      const alone = await list(`?from=2099-11-19&to=2099-11-19&cursor=${MISSING_ID}`);
      expect(alone.status).toBe(400);
      expect((await errorOf(alone)).fields?.cursor).toBe("Isian tidak valid.");
    });

    it("the ranged service refuses a missing range instead of listing every Activity", async () => {
      await expect(listActivities({ to: "2099-11-19" })).rejects.toMatchObject({ status: 400 });
      await expect(listActivities({})).rejects.toMatchObject({ status: 400 });
    });

    it("includes Done and Cancelled Activities, and flags only Scheduled ones in the past as overdue", async () => {
      const prospectId = await insertProspect("SDN 3 Cibinong");
      const late = await createOk({ prospectId, startsAt: inHours(-2), purpose: "Terlambat" });
      const cancelled = await createOk({ prospectId, startsAt: inHours(-1), purpose: "Batal" });
      await cancel(cancelled.id, 1);
      const later = await createOk({ prospectId, startsAt: inHours(1), purpose: "Nanti" });
      const from = new Date(Date.now() - 48 * HOUR).toISOString().slice(0, 10);
      const to = new Date(Date.now() + 48 * HOUR).toISOString().slice(0, 10);
      const items = await listOk(`?from=${from}&to=${to}`);
      expect(items.map((item) => [item.id, item.status, item.overdue])).toEqual([
        [late.id, "scheduled", true],
        [cancelled.id, "cancelled", false],
        [later.id, "scheduled", false],
      ]);
      const fixedNow = await listActivities({ from, to }, { now: new Date(Date.now() + 2 * HOUR) });
      expect(fixedNow.map((item) => item.overdue)).toEqual([true, false, true]);
    });

    it("validates the query: from and to are required calendar days, to not before from, the Funding Officer a UUID", async () => {
      const cases: [string, string, string][] = [
        ["", "from", "Wajib diisi."],
        ["?from=2099-11-19", "to", "Wajib diisi."],
        ["?from=2099-02-30&to=2099-03-01", "from", "Tanggal tidak valid."],
        ["?from=2099-11-19&to=19-11-2099", "to", "Tanggal tidak valid."],
        ["?from=2099-11-19&to=2099-11-18", "to", "Tanggal akhir tidak boleh sebelum tanggal awal."],
        ["?from=2099-11-19&to=2099-11-19&fundingOfficerId=rina", "fundingOfficerId", "Isian tidak valid."],
      ];
      for (const [query, field, message] of cases) {
        const response = await list(query);
        expect(response.status, query).toBe(400);
        expect((await errorOf(response)).fields?.[field], query).toBe(message);
      }
      expect(await listOk("?from=2099-11-19&to=2099-11-19&fundingOfficerId=")).toEqual([]);
    });
  });

  describe("criterion 5: archiving a Prospect cancels its future Scheduled Activities and reports how many; the preview counts them first (EC19)", () => {
    async function setUp() {
      const prospectId = await insertProspect("SDN 3 Cibinong");
      const otherId = await insertProspect("Pasar Anyar");
      const future = [await createOk({ prospectId, startsAt: inHours(2) }), await createOk({ prospectId, startsAt: inHours(48) })];
      const past = await createOk({ prospectId, startsAt: inHours(-2) });
      const cancelledFuture = await createOk({ prospectId, startsAt: inHours(3) });
      await cancel(cancelledFuture.id, 1);
      const doneFuture = await createOk({ prospectId, startsAt: inHours(4) });
      await sql`update activity set status = 'done' where id = ${doneFuture.id}`;
      const other = await createOk({ prospectId: otherId, startsAt: inHours(2) });
      return { prospectId, future, past, other };
    }

    it("the preview answers the count of future Scheduled Activities and changes nothing", async () => {
      const { prospectId } = await setUp();
      const response = await preview(prospectId);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(await response.json()).toEqual({ futureScheduledActivities: 2 });
      expect((await sql`select count(*)::int as n from activity where status = 'scheduled'`)[0].n).toBe(4);
      expect(await (await preview(await insertProspect("Kosong"))).json()).toEqual({ futureScheduledActivities: 0 });
      for (const id of [MISSING_ID, "bukan-uuid"]) expect((await preview(id)).status).toBe(404);
    });

    it("archive cancels exactly those, answers cancelledActivities, and leaves past, Done, Cancelled and other Prospects' Activities alone", async () => {
      const { prospectId, future, past, other } = await setUp();
      const response = await archive(prospectId, await prospectVersion(prospectId));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ id: prospectId, archived: true, cancelledActivities: 2 });
      for (const activity of future) {
        expect((await (await get(activity.id)).json()) as Activity).toMatchObject({ status: "cancelled", version: 2 });
      }
      expect((await (await get(past.id)).json()) as Activity).toMatchObject({ status: "scheduled", overdue: true });
      expect((await (await get(other.id)).json()) as Activity).toMatchObject({ status: "scheduled" });
      expect((await sql`select status::text, count(*)::int as n from activity group by status order by status`).map((row) => [row.status, row.n])).toEqual([
        ["cancelled", 3],
        ["done", 1],
        ["scheduled", 2],
      ]);
      expect(await (await preview(prospectId)).json()).toEqual({ futureScheduledActivities: 0 });
    });

    it("archiving again is idempotent and cancels nothing more; nothing is cancelled when the archive is refused", async () => {
      const { prospectId } = await setUp();
      const version = await prospectVersion(prospectId);
      await archive(prospectId, version);
      const again = await archive(prospectId, version);
      expect(again.status).toBe(200);
      expect(await again.json()).toMatchObject({ archived: true, cancelledActivities: 0 });

      const blockedId = await insertProspect("SMPN 1 Bogor");
      const kept = await createOk({ prospectId: blockedId, startsAt: inHours(2) });
      await insertPipeline(blockedId);
      const refused = await archive(blockedId, 1);
      expect(refused.status).toBe(422);
      expect((await errorOf(refused)).code).toBe("prospect_has_open_pipeline");
      expect((await sql`select status from activity where id = ${kept.id}`)[0].status).toBe("scheduled");
    });

    it("a stale version cancels nothing", async () => {
      const prospectId = await insertProspect("SDN 3 Cibinong");
      const kept = await createOk({ prospectId, startsAt: inHours(2) });
      const response = await archive(prospectId, 99);
      expect(response.status).toBe(409);
      expect((await sql`select status from activity where id = ${kept.id}`)[0].status).toBe("scheduled");
    });
  });

  describe("criterion 6: there is no endpoint that deletes an Activity (EC22)", () => {
    it("no route under /api/activities exports DELETE, and the database refuses to delete a Prospect with Activities", async () => {
      const dir = join(process.cwd(), "src", "app", "api", "activities");
      const files = (function walk(path: string): string[] {
        return readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
          entry.isDirectory() ? walk(join(path, entry.name)) : entry.name.startsWith("route.") ? [join(path, entry.name)] : [],
        );
      })(dir);
      expect(files).toHaveLength(3);
      for (const route of [activitiesRoute, activityRoute, cancelRoute]) expect("DELETE" in route).toBe(false);
      expect(Object.keys(activitiesRoute).sort()).toEqual(["GET", "POST"]);
      const prospectId = await insertProspect("SDN 3 Cibinong");
      await createOk({ prospectId });
      await expect(sql`delete from prospect where id = ${prospectId}`).rejects.toThrow(/foreign key/);
    });
  });
});
