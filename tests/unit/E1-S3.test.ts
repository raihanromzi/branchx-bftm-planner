// E1-S3: before deactivating a Funding Officer, the Admin sees their open work; deactivating moves
// nothing, and every Prospect, Pipeline and Activity response says when its Funding Officer is inactive (EC20).
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "@/server/auth/password";
import { SESSION_COOKIE, hashSessionToken } from "@/server/auth/session";
import { getDashboard } from "@/server/dashboard";
import * as previewRoute from "@/app/api/funding-officers/[id]/deactivation-preview/route";
import * as deactivateRoute from "@/app/api/funding-officers/[id]/deactivate/route";
import * as prospectsRoute from "@/app/api/prospects/route";
import * as prospectRoute from "@/app/api/prospects/[id]/route";
import * as pipelinesRoute from "@/app/api/pipelines/route";
import * as pipelineRoute from "@/app/api/pipelines/[id]/route";
import * as activitiesRoute from "@/app/api/activities/route";
import * as activityRoute from "@/app/api/activities/[id]/route";
import { migrateTestDatabase, testDatabaseUrl, truncateAllTables } from "./support/test-db";

const TEST_URL = testDatabaseUrl();
const ORIGIN = "http://localhost:3000";
const MISSING_ID = "00000000-0000-4000-8000-000000000000";
let sql: postgres.Sql;
let token: string;
let rina: Officer;
let agus: Officer;

type Officer = { id: string; name: string };
type OfficerRef = { id: string; name: string; active: boolean };
type Preview = { prospects: number; openPipelines: number; futureScheduledActivities: number };

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

async function insertOfficer(name: string): Promise<Officer> {
  const [row] = await sql<Officer[]>`
    insert into funding_officer (name, phone) values (${name}, '+6281234567890') returning id, name`;
  return row;
}

async function insertProspect(officer: Officer, archived = false): Promise<string> {
  const name = `P ${randomUUID()}`;
  const [row] = await sql<{ id: string }[]>`
    insert into prospect (name, name_key, funding_officer_id, archived_at)
    values (${name}, ${name.toLowerCase()}, ${officer.id}, ${archived ? sql`now()` : null}) returning id`;
  return row.id;
}

/** A Pipeline with one Stage, on its own Prospect (owned by `prospectOfficer`), for `officer`. */
async function insertPipeline(
  officer: Officer,
  outcome: "won" | "lost" | "on_hold" | null = null,
  prospectOfficer: Officer = officer,
): Promise<string> {
  const prospectId = await insertProspect(prospectOfficer);
  const [template] = await sql<{ id: string }[]>`
    insert into pipeline_template (name, name_key) values (${`T ${randomUUID()}`}, ${randomUUID()}) returning id`;
  const won = outcome === "won";
  const [row] = await sql<{ id: string }[]>`
    insert into pipeline (prospect_id, template_id, funding_officer_id, outcome, accounts_opened, won_on, lost_reason, closed_at)
    values (${prospectId}, ${template.id}, ${officer.id}, ${outcome}, ${won ? 10 : null}, ${won ? "2026-11-01" : null},
            ${outcome === "lost" ? "Tidak berminat" : null}, ${won || outcome === "lost" ? sql`now()` : null})
    returning id`;
  await sql`insert into pipeline_stage (pipeline_id, position, name) values (${row.id}, 1, 'Presentasi')`;
  return row.id;
}

/** An Activity `hours` from now (negative: in the past) on its own Prospect. */
async function insertActivity(
  officer: Officer,
  hours: number,
  status: "scheduled" | "done" | "cancelled" = "scheduled",
  prospectOfficer: Officer = officer,
): Promise<string> {
  const prospectId = await insertProspect(prospectOfficer);
  const [row] = await sql<{ id: string }[]>`
    insert into activity (prospect_id, funding_officer_id, starts_at, purpose, status)
    values (${prospectId}, ${officer.id}, now() + ${hours} * interval '1 hour', 'Kunjungan', ${status}) returning id`;
  return row.id;
}

function request(path: string, method: string, { body, auth = true }: { body?: unknown; auth?: boolean } = {}) {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: {
      host: "localhost:3000",
      "content-type": "application/json",
      ...(auth ? { cookie: `${SESSION_COOKIE}=${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

function preview(id: string, auth = true) {
  return previewRoute.GET(request(`/api/funding-officers/${id}/deactivation-preview`, "GET", { auth }), ctx(id));
}

async function previewOk(id: string): Promise<Preview> {
  const response = await preview(id);
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
  expect(response.headers.get("cache-control")).toContain("no-store");
  return (await response.json()) as Preview;
}

async function deactivate(officer: Officer) {
  const [{ version }] = await sql<{ version: number }[]>`select version from funding_officer where id = ${officer.id}`;
  const response = await deactivateRoute.POST(
    request(`/api/funding-officers/${officer.id}/deactivate`, "POST", { body: { version } }),
    ctx(officer.id),
  );
  expect(response.status).toBe(200);
}

async function json<T>(response: Response | Promise<Response>): Promise<T> {
  const res = await response;
  expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
  return (await res.json()) as T;
}

describe("E1-S3 open work of a Funding Officer being deactivated", () => {
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

  describe("criterion 1: the deactivation preview counts Prospects (not archived), open Pipelines and future Scheduled Activities (EC20)", () => {
    it("counts only the Funding Officer's own records that match each rule", async () => {
      // Prospects: 2 counted, 1 archived left out. (Pipelines and Activities below add their own Prospects for agus.)
      await insertProspect(rina);
      await insertProspect(rina);
      await insertProspect(rina, true);
      // Pipelines: open ones are counted; On Hold, Won and Lost have an Outcome and are not open.
      await insertPipeline(rina, null, agus);
      await insertPipeline(rina, null, agus);
      await insertPipeline(rina, "on_hold", agus);
      await insertPipeline(rina, "won", agus);
      await insertPipeline(rina, "lost", agus);
      // Activities: Scheduled in the future counted; past, Done and Cancelled are not.
      await insertActivity(rina, 2, "scheduled", agus);
      await insertActivity(rina, 48, "scheduled", agus);
      await insertActivity(rina, 72, "scheduled", agus);
      await insertActivity(rina, -2, "scheduled", agus);
      await insertActivity(rina, 24, "cancelled", agus);
      await insertActivity(rina, -24, "done", agus);
      // Someone else's work is not counted.
      await insertProspect(agus);
      await insertPipeline(agus);
      await insertActivity(agus, 24);

      expect(await previewOk(rina.id)).toEqual({ prospects: 2, openPipelines: 2, futureScheduledActivities: 3 });
    });

    it("counts each kind by its own Funding Officer: a Pipeline or Activity of rina's on agus's Prospect counts for rina only", async () => {
      await insertPipeline(rina, null, agus);
      await insertActivity(rina, 24, "scheduled", agus);
      expect(await previewOk(rina.id)).toEqual({ prospects: 0, openPipelines: 1, futureScheduledActivities: 1 });
      expect(await previewOk(agus.id)).toEqual({ prospects: 2, openPipelines: 0, futureScheduledActivities: 0 });
    });

    it("answers zeros for a Funding Officer with no work, and still answers once they are inactive", async () => {
      expect(await previewOk(rina.id)).toEqual({ prospects: 0, openPipelines: 0, futureScheduledActivities: 0 });
      await insertProspect(rina);
      await deactivate(rina);
      expect(await previewOk(rina.id)).toEqual({ prospects: 1, openPipelines: 0, futureScheduledActivities: 0 });
    });

    it("changes nothing, answers 404 for an unknown or non-UUID id, and 401 without a session", async () => {
      await insertProspect(rina);
      const before = await sql`select * from funding_officer order by id`;
      await previewOk(rina.id);
      expect(await sql`select * from funding_officer order by id`).toEqual(before);

      expect((await preview(MISSING_ID)).status).toBe(404);
      expect((await preview("nope")).status).toBe(404);
      expect((await preview(rina.id, false)).status).toBe(401);
    });
  });

  describe("criterion 2: deactivating changes no Funding Officer on any Prospect, Pipeline or Activity, and no past Actual (EC20)", () => {
    it("leaves every row of rina's work untouched and the month's Actual the same", async () => {
      await insertProspect(rina);
      await insertProspect(rina, true);
      await insertPipeline(rina);
      await insertPipeline(rina, "on_hold");
      await insertPipeline(rina, "won");
      await insertActivity(rina, 24);
      await insertActivity(rina, -24, "done");
      const snapshot = async () => ({
        prospects: await sql`select * from prospect order by id`,
        pipelines: await sql`select * from pipeline order by id`,
        activities: await sql`select * from activity order by id`,
      });
      const before = await snapshot();
      const actualBefore = (await getDashboard("2026-11")).fundingOfficers.find((row) => row.fundingOfficer.id === rina.id);
      expect(actualBefore?.actual).toBe(10);

      await deactivate(rina);

      expect(await snapshot()).toEqual(before);
      const after = (await getDashboard("2026-11")).fundingOfficers.find((row) => row.fundingOfficer.id === rina.id);
      expect(after?.actual).toBe(10);
      expect(after?.fundingOfficer.active).toBe(false);
      expect(await previewOk(rina.id)).toEqual({ prospects: 6, openPipelines: 1, futureScheduledActivities: 1 });
    });
  });

  describe("criterion 3: Prospect, Pipeline and Activity responses say when their Funding Officer is inactive", () => {
    it("every detail and list response carries fundingOfficer.active false after deactivation", async () => {
      const pipelineId = await insertPipeline(rina);
      const [{ prospectId }] = await sql<{ prospectId: string }[]>`select prospect_id as "prospectId" from pipeline where id = ${pipelineId}`;
      const activityId = await insertActivity(rina, 24);
      await deactivate(rina);
      const inactive: OfficerRef = { id: rina.id, name: "Rina Kartika", active: false };

      const prospect = await json<{ fundingOfficer: OfficerRef }>(prospectRoute.GET(request(`/api/prospects/${prospectId}`, "GET"), ctx(prospectId)));
      expect(prospect.fundingOfficer).toEqual(inactive);
      const prospects = await json<{ items: { id: string; fundingOfficer: OfficerRef }[] }>(prospectsRoute.GET(request("/api/prospects", "GET")));
      expect(prospects.items.find((item) => item.id === prospectId)?.fundingOfficer).toEqual(inactive);

      const pipeline = await json<{ fundingOfficer: OfficerRef }>(pipelineRoute.GET(request(`/api/pipelines/${pipelineId}`, "GET"), ctx(pipelineId)));
      expect(pipeline.fundingOfficer).toEqual(inactive);
      const pipelines = await json<{ items: { fundingOfficer: OfficerRef }[] }>(
        pipelinesRoute.GET(request(`/api/pipelines?prospectId=${prospectId}`, "GET")),
      );
      expect(pipelines.items[0].fundingOfficer).toEqual(inactive);

      const activity = await json<{ fundingOfficer: OfficerRef }>(activityRoute.GET(request(`/api/activities/${activityId}`, "GET"), ctx(activityId)));
      expect(activity.fundingOfficer).toEqual(inactive);
      const from = new Date().toISOString().slice(0, 10);
      const to = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
      const activities = await json<{ items: { id: string; fundingOfficer: OfficerRef }[] }>(
        activitiesRoute.GET(request(`/api/activities?from=${from}&to=${to}`, "GET")),
      );
      expect(activities.items.find((item) => item.id === activityId)?.fundingOfficer).toEqual(inactive);
    });
  });
});
