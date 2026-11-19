// E5-S1: monthly Targets per Funding Officer, and the dashboard summary computed from Won Pipelines,
// Overdue Tasks and Activities, upcoming Activities and open Pipelines by Stage.
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "@/server/auth/password";
import { SESSION_COOKIE, hashSessionToken } from "@/server/auth/session";
import { TARGET_MESSAGE, getDashboard, wibMonth } from "@/server/dashboard";
import { setPipelineOutcome } from "@/server/pipelines";
import * as targetsRoute from "@/app/api/targets/route";
import * as dashboardRoute from "@/app/api/dashboard/route";
import * as reopenRoute from "@/app/api/pipelines/[id]/reopen/route";
import { migrateTestDatabase, testDatabaseUrl, truncateAllTables } from "./support/test-db";

const TEST_URL = testDatabaseUrl();
const ORIGIN = "http://localhost:3000";
let sql: postgres.Sql;
let token: string;
let rina: Officer;
let agus: Officer;

type Officer = { id: string; name: string };
type ErrorBody = { error: { code: string; message: string; fields?: Record<string, string> } };
type TargetRecord = { fundingOfficerId: string; month: string; accounts: number; version: number };
type TargetMonth = {
  month: string;
  items: { fundingOfficer: { id: string; name: string; active: boolean }; target: number | null; version: number | null; actual: number }[];
};
type Progress = { target: number | null; actual: number; previousActual: number };
type Dashboard = {
  month: string;
  previousMonth: string;
  today: string;
  team: Progress;
  fundingOfficers: (Progress & { fundingOfficer: { id: string; name: string; active: boolean } })[];
  overdue: { tasks: { id: string; name: string; dueOn: string; pipeline: { id: string } }[]; activities: { id: string; overdue: boolean }[] };
  upcoming: { today: { id: string }[]; next7Days: { id: string }[] };
  pipelinesByStage: { template: { id: string; name: string }; stages: { position: number; name: string; count: number }[] }[];
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
    insert into funding_officer (name, phone, active) values (${name}, '+6281234567890', ${active}) returning id, name`;
  return row;
}

async function insertProspect(name: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into prospect (name, name_key, funding_officer_id) values (${name}, ${name.toLowerCase()}, ${rina.id}) returning id`;
  return row.id;
}

async function insertTemplate(name: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into pipeline_template (name, name_key) values (${name}, ${name.toLowerCase()}) returning id`;
  return row.id;
}

const STAGES = ["Identifikasi", "Pendekatan", "Presentasi"];

/** A Pipeline on its own Prospect, with three Stages, at `stage`, with the given Outcome. */
async function insertPipeline({
  officer = rina,
  templateId,
  outcome = null,
  accounts = 10,
  wonOn = "2026-11-01",
  stage = 1,
}: {
  officer?: Officer;
  templateId?: string;
  outcome?: "won" | "lost" | "on_hold" | null;
  accounts?: number;
  wonOn?: string;
  stage?: number;
} = {}): Promise<string> {
  const prospectId = await insertProspect(`P ${randomUUID()}`);
  templateId ??= await insertTemplate(`T ${randomUUID()}`);
  const won = outcome === "won";
  const [row] = await sql<{ id: string }[]>`
    insert into pipeline (prospect_id, template_id, funding_officer_id, current_stage_position, outcome, accounts_opened, won_on, lost_reason, closed_at)
    values (${prospectId}, ${templateId}, ${officer.id}, ${stage}, ${outcome}, ${won ? accounts : null}, ${won ? wonOn : null},
            ${outcome === "lost" ? "Tidak berminat" : null}, ${won || outcome === "lost" ? sql`now()` : null})
    returning id`;
  for (const [index, name] of STAGES.entries()) {
    await sql`insert into pipeline_stage (pipeline_id, position, name) values (${row.id}, ${index + 1}, ${name})`;
  }
  return row.id;
}

async function insertTask(pipelineId: string, name: string, dueOn: string | null, done = false): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into pipeline_task (stage_id, position, name, due_on, done_at)
    select id, (select count(*) + 1 from pipeline_task t where t.stage_id = pipeline_stage.id), ${name}, ${dueOn}, ${done ? sql`now()` : null}
    from pipeline_stage where pipeline_id = ${pipelineId} and position = 1
    returning id`;
  return row.id;
}

async function insertActivity(startsAt: string, status: "scheduled" | "done" | "cancelled" = "scheduled", officer = rina): Promise<string> {
  const prospectId = await insertProspect(`A ${randomUUID()}`);
  const [row] = await sql<{ id: string }[]>`
    insert into activity (prospect_id, funding_officer_id, starts_at, purpose, status)
    values (${prospectId}, ${officer.id}, ${startsAt}, 'Kunjungan', ${status}) returning id`;
  return row.id;
}

function request(path: string, method: string, { body, auth = true, headers = {} }: { body?: unknown; auth?: boolean; headers?: Record<string, string> } = {}) {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: {
      host: "localhost:3000",
      "content-type": "application/json",
      ...(auth ? { cookie: `${SESSION_COOKIE}=${token}` } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function put(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return targetsRoute.PUT(request("/api/targets", "PUT", { body, headers }));
}

async function putOk(body: Record<string, unknown>): Promise<TargetRecord> {
  const response = await put(body);
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
  return (await response.json()) as TargetRecord;
}

async function targets(month: string): Promise<TargetMonth> {
  const response = await targetsRoute.GET(request(`/api/targets?month=${month}`, "GET"));
  expect(response.status).toBe(200);
  return (await response.json()) as TargetMonth;
}

async function dashboard(month: string): Promise<Dashboard> {
  const response = await dashboardRoute.GET(request(`/api/dashboard?month=${month}`, "GET"));
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
  expect(response.headers.get("cache-control")).toContain("no-store");
  return (await response.json()) as Dashboard;
}

const officerRow = (data: Dashboard, officer: Officer) => data.fundingOfficers.find((row) => row.fundingOfficer.id === officer.id);

describe("E5-S1 Targets and the dashboard summary", () => {
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

  describe("criterion 1: a Target is unique per Funding Officer and month, setting it again updates it, and it is an integer from 0 to 100,000 (EC10, EC17)", () => {
    it("inserts with version null, then updates the same row with its version", async () => {
      const first = await putOk({ fundingOfficerId: rina.id, month: "2026-11", accounts: 400, version: null });
      expect(first).toEqual({ fundingOfficerId: rina.id, month: "2026-11", accounts: 400, version: 1 });
      const second = await putOk({ fundingOfficerId: rina.id, month: "2026-11", accounts: 450, version: 1 });
      expect(second).toEqual({ fundingOfficerId: rina.id, month: "2026-11", accounts: 450, version: 2 });
      expect((await sql`select count(*)::int as n from target`)[0].n).toBe(1);

      const listed = await targets("2026-11");
      expect(listed.items.find((row) => row.fundingOfficer.id === rina.id)).toEqual({
        fundingOfficer: { id: rina.id, name: "Rina Kartika", active: true },
        target: 450,
        version: 2,
        actual: 0,
      });
    });

    it("refuses a stale version or a second insert with 409, and a repeat of the stored value is answered unchanged", async () => {
      await putOk({ fundingOfficerId: rina.id, month: "2026-11", accounts: 400, version: null });
      const insertAgain = await put({ fundingOfficerId: rina.id, month: "2026-11", accounts: 500, version: null });
      expect(insertAgain.status).toBe(409);
      expect(((await insertAgain.json()) as ErrorBody).error.code).toBe("version_conflict");
      await putOk({ fundingOfficerId: rina.id, month: "2026-11", accounts: 450, version: 1 });
      const stale = await put({ fundingOfficerId: rina.id, month: "2026-11", accounts: 300, version: 1 });
      expect(stale.status).toBe(409);
      expect((await putOk({ fundingOfficerId: rina.id, month: "2026-11", accounts: 450, version: 1 })).version).toBe(2);
      expect((await sql`select accounts from target`)[0].accounts).toBe(450);
    });

    it("keeps months and Funding Officers apart", async () => {
      await putOk({ fundingOfficerId: rina.id, month: "2026-11", accounts: 400, version: null });
      await putOk({ fundingOfficerId: rina.id, month: "2026-12", accounts: 500, version: null });
      await putOk({ fundingOfficerId: agus.id, month: "2026-11", accounts: 350, version: null });
      expect((await sql`select count(*)::int as n from target`)[0].n).toBe(3);
    });

    it("the database refuses a second row for the same Funding Officer and month", async () => {
      await sql`insert into target (funding_officer_id, month, accounts) values (${rina.id}, '2026-11-01', 1)`;
      await expect(sql`insert into target (funding_officer_id, month, accounts) values (${rina.id}, '2026-11-01', 2)`).rejects.toThrow(/unique/);
      await expect(sql`insert into target (funding_officer_id, month, accounts) values (${agus.id}, '2026-11-01', 100001)`).rejects.toThrow(/target_accounts_range/);
    });

    it("accepts 0 and 100,000 and refuses negative, decimal, too large or text values with the Target message", async () => {
      expect((await putOk({ fundingOfficerId: rina.id, month: "2026-11", accounts: 0, version: null })).accounts).toBe(0);
      expect((await putOk({ fundingOfficerId: agus.id, month: "2026-11", accounts: 100_000, version: null })).accounts).toBe(100_000);
      for (const accounts of [-1, 1.5, 100_001, "10"]) {
        const response = await put({ fundingOfficerId: rina.id, month: "2026-12", accounts, version: null });
        expect(response.status).toBe(400);
        expect(((await response.json()) as ErrorBody).error.fields).toEqual({ accounts: TARGET_MESSAGE });
      }
      for (const month of ["2026-13", "2026-1", "2026-11-01", ""]) {
        const response = await put({ fundingOfficerId: rina.id, month, accounts: 1, version: null });
        expect(response.status).toBe(400);
        expect(((await response.json()) as ErrorBody).error.fields?.month).toBeDefined();
      }
      expect((await sql`select count(*)::int as n from target`)[0].n).toBe(2);
    });

    it("refuses an inactive or unknown Funding Officer with 422, and needs a session and the same origin", async () => {
      const dedi = await insertOfficer("Dedi Pratama", false);
      const inactive = await put({ fundingOfficerId: dedi.id, month: "2026-11", accounts: 1, version: null });
      expect(inactive.status).toBe(422);
      expect(((await inactive.json()) as ErrorBody).error.code).toBe("funding_officer_inactive");
      const unknown = await put({ fundingOfficerId: randomUUID(), month: "2026-11", accounts: 1, version: null });
      expect(((await unknown.json()) as ErrorBody).error.code).toBe("funding_officer_not_found");
      const crossOrigin = await put({ fundingOfficerId: rina.id, month: "2026-11", accounts: 1, version: null }, { origin: "https://evil.example" });
      expect(crossOrigin.status).toBe(403);
      const signedOut = await targetsRoute.PUT(
        request("/api/targets", "PUT", { body: { fundingOfficerId: rina.id, month: "2026-11", accounts: 1, version: null }, auth: false }),
      );
      expect(signedOut.status).toBe(401);
      expect((await targetsRoute.GET(request("/api/targets?month=2026-11", "GET", { auth: false }))).status).toBe(401);
      expect((await dashboardRoute.GET(request("/api/dashboard?month=2026-11", "GET", { auth: false }))).status).toBe(401);
      expect((await sql`select count(*)::int as n from target`)[0].n).toBe(0);
    });
  });

  describe("criterion 2: Actual is the sum of Accounts Opened over Pipelines Won in that WIB calendar month, credited to the Pipeline's Funding Officer (EC26, EC31)", () => {
    it("sums Won Pipelines in the month per the Pipeline's Funding Officer, ignoring other months and Outcomes", async () => {
      await insertPipeline({ outcome: "won", accounts: 120, wonOn: "2026-11-01" });
      await insertPipeline({ outcome: "won", accounts: 30, wonOn: "2026-11-30" });
      await insertPipeline({ officer: agus, outcome: "won", accounts: 50, wonOn: "2026-11-15" });
      await insertPipeline({ outcome: "won", accounts: 999, wonOn: "2026-12-01" });
      await insertPipeline({ outcome: "won", accounts: 999, wonOn: "2026-10-31" });
      await insertPipeline({ outcome: "lost" });
      await insertPipeline({ outcome: "on_hold" });
      await insertPipeline();
      const data = await dashboard("2026-11");
      expect(officerRow(data, rina)?.actual).toBe(150);
      expect(officerRow(data, agus)?.actual).toBe(50);
      expect(data.team.actual).toBe(200);
      expect((await targets("2026-11")).items.find((row) => row.fundingOfficer.id === rina.id)?.actual).toBe(150);
    });

    it("credits the Pipeline's own Funding Officer, not the Prospect's (EC26)", async () => {
      // insertProspect gives every Prospect to Rina; the Pipeline is Agus's.
      await insertPipeline({ officer: agus, outcome: "won", accounts: 40, wonOn: "2026-11-10" });
      const data = await dashboard("2026-11");
      expect(officerRow(data, agus)?.actual).toBe(40);
      expect(officerRow(data, rina)?.actual).toBe(0);
    });

    it("a Pipeline Won at 23:30 WIB on 31 January counts in January; at 00:30 WIB on 1 February in February (EC31)", async () => {
      const late = await insertPipeline();
      await setPipelineOutcome(late, { outcome: "won", accountsOpened: 7, wonOn: "2026-01-31", version: 1 }, { now: new Date("2026-01-31T16:30:00Z") });
      const next = await insertPipeline();
      const now = new Date("2026-01-31T17:30:00Z");
      expect(wibMonth(now)).toBe("2026-02");
      await setPipelineOutcome(next, { outcome: "won", accountsOpened: 3, wonOn: "2026-02-01", version: 1 }, { now });
      expect((await dashboard("2026-01")).team.actual).toBe(7);
      expect((await dashboard("2026-02")).team.actual).toBe(3);
      expect(wibMonth(new Date("2026-01-31T16:30:00Z"))).toBe("2026-01");
      expect((await getDashboard(undefined, { now })).month).toBe("2026-02");
    });
  });

  describe("criterion 3: the team Target is the sum of the Funding Officers' Targets; no Target reports null, not 0 (EC4)", () => {
    it("sums the set Targets and reports null for a Funding Officer without one", async () => {
      await putOk({ fundingOfficerId: rina.id, month: "2026-11", accounts: 600, version: null });
      await putOk({ fundingOfficerId: agus.id, month: "2026-11", accounts: 0, version: null });
      await insertOfficer("Dedi Pratama");
      const data = await dashboard("2026-11");
      expect(data.team.target).toBe(600);
      expect(officerRow(data, agus)?.target).toBe(0);
      expect(data.fundingOfficers.find((row) => row.fundingOfficer.name === "Dedi Pratama")?.target).toBeNull();
    });

    it("a month with no Target reports target null for the team and each Funding Officer, with Actual still computed", async () => {
      await insertPipeline({ outcome: "won", accounts: 25, wonOn: "2026-11-05" });
      const data = await dashboard("2026-11");
      expect(data.team).toEqual({ target: null, actual: 25, previousActual: 0 });
      expect(data.fundingOfficers.every((row) => row.target === null)).toBe(true);
      expect((await targets("2026-11")).items.every((row) => row.target === null && row.version === null)).toBe(true);
    });
  });

  describe("criterion 4: per Funding Officer and for the team, Target, Actual and the previous month's Actual", () => {
    it("returns the three figures, across a year boundary, with active Funding Officers by name and an inactive one only when it has figures", async () => {
      const dedi = await insertOfficer("Dedi Pratama");
      const eko = await insertOfficer("Eko Nonaktif", false);
      await insertOfficer("Fajar Nonaktif", false);
      await putOk({ fundingOfficerId: rina.id, month: "2027-01", accounts: 600, version: null });
      await putOk({ fundingOfficerId: agus.id, month: "2027-01", accounts: 700, version: null });
      await insertPipeline({ outcome: "won", accounts: 520, wonOn: "2027-01-10" });
      await insertPipeline({ outcome: "won", accounts: 410, wonOn: "2026-12-20" });
      await insertPipeline({ officer: agus, outcome: "won", accounts: 100, wonOn: "2026-12-31" });
      await insertPipeline({ officer: eko, outcome: "won", accounts: 5, wonOn: "2026-12-02" });

      const data = await dashboard("2027-01");
      expect(data.month).toBe("2027-01");
      expect(data.previousMonth).toBe("2026-12");
      expect(data.team).toEqual({ target: 1300, actual: 520, previousActual: 515 });
      expect(data.fundingOfficers.map((row) => [row.fundingOfficer.name, row.target, row.actual, row.previousActual])).toEqual([
        ["Agus Setiawan", 700, 0, 100],
        ["Dedi Pratama", null, 0, 0],
        ["Rina Kartika", 600, 520, 410],
      ]);
      expect(dedi).toBeDefined();
      // Eko is inactive and has nothing in January, so January leaves him out; December shows him.
      const december = await dashboard("2026-12");
      expect(officerRow(december, eko)).toEqual({ fundingOfficer: { id: eko.id, name: "Eko Nonaktif", active: false }, target: null, actual: 5, previousActual: 0 });
      expect(december.fundingOfficers.some((row) => row.fundingOfficer.name === "Fajar Nonaktif")).toBe(false);
    });

    it("defaults to the current WIB month and refuses an invalid month with 400", async () => {
      const response = await dashboardRoute.GET(request("/api/dashboard", "GET"));
      expect(((await response.json()) as Dashboard).month).toBe(wibMonth());
      const bad = await dashboardRoute.GET(request("/api/dashboard?month=2026-13", "GET"));
      expect(bad.status).toBe(400);
      expect(((await bad.json()) as ErrorBody).error.fields?.month).toBe("Bulan tidak valid.");
      expect((await targetsRoute.GET(request("/api/targets?month=nov", "GET"))).status).toBe(400);
    });
  });

  describe("criterion 5: Overdue Tasks (WIB due date passed, unticked, open Pipeline) and Overdue Activities (time passed, still Scheduled) (EC30)", () => {
    // 2026-11-19 00:30 WIB: "yesterday" in WIB is 2026-11-18, while the UTC day is still 2026-11-18.
    const now = new Date("2026-11-18T17:30:00Z");

    it("lists only the Tasks that are Overdue by the WIB day, oldest due date first", async () => {
      const open = await insertPipeline();
      const overdueOld = await insertTask(open, "Kirim proposal", "2026-11-10");
      const overdueYesterday = await insertTask(open, "Telepon kepala sekolah", "2026-11-18");
      await insertTask(open, "Jadwalkan presentasi", "2026-11-19");
      await insertTask(open, "Sudah selesai", "2026-11-01", true);
      await insertTask(open, "Tanpa tenggat", null);
      for (const outcome of ["won", "lost", "on_hold"] as const) {
        await insertTask(await insertPipeline({ outcome }), "Tutup", "2026-11-01");
      }
      const data = await getDashboard("2026-11", { now });
      expect(data.overdue.tasks.map((task) => task.id)).toEqual([overdueOld, overdueYesterday]);
      expect(data.overdue.tasks[0]).toEqual({
        id: overdueOld,
        name: "Kirim proposal",
        dueOn: "2026-11-10",
        pipeline: { id: open, stage: { position: 1, name: "Identifikasi" } },
        prospect: { id: expect.any(String), name: expect.stringMatching(/^P /) },
        fundingOfficer: { id: rina.id, name: "Rina Kartika", active: true },
      });
    });

    it("lists only Scheduled Activities whose time has passed, oldest first", async () => {
      const older = await insertActivity("2026-11-17T02:00:00Z");
      const justPassed = await insertActivity("2026-11-18T17:00:00Z");
      await insertActivity("2026-11-18T18:00:00Z");
      await insertActivity("2026-11-10T02:00:00Z", "done");
      await insertActivity("2026-11-10T02:00:00Z", "cancelled");
      const data = await getDashboard("2026-11", { now });
      expect(data.overdue.activities.map((item) => item.id)).toEqual([older, justPassed]);
      expect(data.overdue.activities.every((item) => item.overdue)).toBe(true);
    });

    it("the HTTP summary carries the same lists", async () => {
      const open = await insertPipeline();
      const task = await insertTask(open, "Kirim proposal", "2020-01-01");
      const activity = await insertActivity("2020-01-01T02:00:00Z");
      const data = await dashboard("2026-11");
      expect(data.overdue.tasks.map((item) => item.id)).toEqual([task]);
      expect(data.overdue.activities.map((item) => item.id)).toEqual([activity]);
    });
  });

  describe("criterion 6: today's and the next 7 days' Activities, and open Pipelines counted by Stage, grouped by template, then Stage position and name", () => {
    it("splits today's Activities (WIB) from the next 7 WIB days', in time order, and leaves out later ones", async () => {
      const now = new Date("2026-11-19T03:00:00Z"); // 10.00 WIB, 19 November
      await insertActivity("2026-11-18T16:59:00Z"); // 23.59 WIB on the 18th
      const earlyToday = await insertActivity("2026-11-18T17:00:00Z"); // 00.00 WIB on the 19th
      const laterToday = await insertActivity("2026-11-19T09:00:00Z", "done");
      const tomorrow = await insertActivity("2026-11-20T02:00:00Z", "scheduled", agus);
      const lastDay = await insertActivity("2026-11-26T16:59:00Z"); // 23.59 WIB on the 26th
      await insertActivity("2026-11-26T17:00:00Z"); // 00.00 WIB on the 27th
      const data = await getDashboard("2026-11", { now });
      expect(data.today).toBe("2026-11-19");
      expect(data.upcoming.today.map((item) => item.id)).toEqual([earlyToday, laterToday]);
      expect(data.upcoming.next7Days.map((item) => item.id)).toEqual([tomorrow, lastDay]);
    });

    it("counts open Pipelines (not On Hold, Won or Lost) by their current Stage, per template", async () => {
      const umum = await insertTemplate("Umum");
      const sekolah = await insertTemplate("Sekolah");
      await insertPipeline({ templateId: umum, stage: 1 });
      await insertPipeline({ templateId: umum, stage: 1 });
      await insertPipeline({ templateId: umum, stage: 3 });
      await insertPipeline({ templateId: sekolah, stage: 2 });
      await insertPipeline({ templateId: umum, stage: 2, outcome: "on_hold" });
      await insertPipeline({ templateId: umum, stage: 2, outcome: "won" });
      await insertPipeline({ templateId: sekolah, stage: 1, outcome: "lost" });
      const data = await dashboard("2026-11");
      expect(data.pipelinesByStage).toEqual([
        { template: { id: sekolah, name: "Sekolah" }, stages: [{ position: 2, name: "Pendekatan", count: 1 }] },
        {
          template: { id: umum, name: "Umum" },
          stages: [
            { position: 1, name: "Identifikasi", count: 2 },
            { position: 3, name: "Presentasi", count: 1 },
          ],
        },
      ]);
    });

    it("with no data, answers empty lists and zero Actuals", async () => {
      await sql`delete from funding_officer`;
      const data = await dashboard("2026-11");
      expect(data.team).toEqual({ target: null, actual: 0, previousActual: 0 });
      expect(data.fundingOfficers).toEqual([]);
      expect(data.overdue).toEqual({ tasks: [], activities: [] });
      expect(data.pipelinesByStage).toEqual([]);
    });
  });

  describe("criterion 7: reopening a Won Pipeline lowers that month's Actual (EC25)", () => {
    it("drops the reopened Pipeline's Accounts Opened from the month's Actual", async () => {
      await insertPipeline({ outcome: "won", accounts: 100, wonOn: "2026-11-05" });
      const reopened = await insertPipeline({ outcome: "won", accounts: 40, wonOn: "2026-11-06" });
      expect((await dashboard("2026-11")).team.actual).toBe(140);
      const response = await reopenRoute.POST(request(`/api/pipelines/${reopened}/reopen`, "POST", { body: { version: 1 } }), {
        params: Promise.resolve({ id: reopened }),
      });
      expect(response.status).toBe(200);
      const data = await dashboard("2026-11");
      expect(data.team.actual).toBe(100);
      expect(officerRow(data, rina)?.actual).toBe(100);
      expect((await dashboard("2026-12")).team.previousActual).toBe(100);
    });
  });
});
