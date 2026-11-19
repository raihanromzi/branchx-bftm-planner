// E3-S3: the Admin starts a Pipeline, moves it between Stages, ticks Tasks and sets its Outcome.
// Also: the Prospect list's openPipeline and Stage filter (#9), the archive guard (#8), and the
// E3-S1 follow-up "Template in use" (pipelineCount and DELETE 409 template_in_use).
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "@/server/auth/password";
import { SESSION_COOKIE, hashSessionToken } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { countPipelinesUsingTemplate } from "@/server/pipeline-templates";
import {
  ACCOUNTS_OPENED_MESSAGE,
  START_SCOPE,
  WON_ON_FUTURE_MESSAGE,
  getPipeline,
  pipelineOutcomeInput,
  setPipelineOutcome,
  updatePipelineTask,
  wibDate,
} from "@/server/pipelines";
import { listProspects, prospectListQuery } from "@/server/prospects";
import * as pipelinesRoute from "@/app/api/pipelines/route";
import * as pipelineRoute from "@/app/api/pipelines/[id]/route";
import * as moveRoute from "@/app/api/pipelines/[id]/move/route";
import * as outcomeRoute from "@/app/api/pipelines/[id]/outcome/route";
import * as reopenRoute from "@/app/api/pipelines/[id]/reopen/route";
import * as taskRoute from "@/app/api/pipeline-tasks/[id]/route";
import * as prospectsRoute from "@/app/api/prospects/route";
import * as prospectRoute from "@/app/api/prospects/[id]/route";
import * as prospectArchiveRoute from "@/app/api/prospects/[id]/archive/route";
import * as prospectRestoreRoute from "@/app/api/prospects/[id]/restore/route";
import * as templatesRoute from "@/app/api/pipeline-templates/route";
import * as templateRoute from "@/app/api/pipeline-templates/[id]/route";
import * as templateArchiveRoute from "@/app/api/pipeline-templates/[id]/archive/route";
import { migrateTestDatabase, testDatabaseUrl, truncateAllTables } from "./support/test-db";

const TEST_URL = testDatabaseUrl();
const ORIGIN = "http://localhost:3000";
const MISSING_ID = "00000000-0000-4000-8000-000000000000";
const GUARD = "Jangan tulis NIK atau nomor rekening nasabah.";
const ALREADY_OPEN = "Prospect ini masih punya Pipeline yang berjalan.";
const ARCHIVED = "Prospect ini diarsipkan. Pulihkan dulu untuk mengubahnya.";
const CLOSE_FIRST = "Tutup atau tunda Pipeline dulu.";
let sql: postgres.Sql;
let token: string;
let rina: Officer;
let agus: Officer;
let template: Template;

type Officer = { id: string; name: string };
type ErrorBody = { error: { code: string; message: string; fields?: Record<string, string> } };
type Template = { id: string; name: string; version: number; pipelineCount: number; stages: { name: string; tasks: { name: string }[] }[] };
type Task = { id: string; position: number; name: string; dueOn: string | null; done: boolean; doneAt: string | null; overdue: boolean; version: number };
type Stage = { id: string; position: number; name: string; tasksDone: number; tasksTotal: number; tasks: Task[] };
type Pipeline = {
  id: string;
  prospect: { id: string; name: string; archived: boolean };
  template: { id: string; name: string };
  fundingOfficer: { id: string; name: string; active: boolean };
  outcome: "won" | "lost" | "on_hold" | null;
  accountsOpened: number | null;
  wonOn: string | null;
  lostReason: string | null;
  currentStagePosition: number;
  currentStage: { id: string; position: number; name: string };
  stageCount: number;
  tasksDone: number;
  tasksTotal: number;
  prospectHasOtherOpenPipeline: boolean;
  startedAt: string;
  closedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  stages: Stage[];
};
type Row = { id: string; name: string; openPipeline: { stageName: string; stagePosition: number; stageCount: number } | null };

const STAGES = [
  { name: "Identifikasi", tasks: [{ name: "Kumpulkan data" }, { name: "Tentukan Kontak" }] },
  { name: "Pendekatan", tasks: [{ name: "Hubungi Kontak" }] },
  { name: "Presentasi", tasks: [{ name: "Siapkan materi" }, { name: "Presentasi" }, { name: "Kirim proposal" }] },
  { name: "Negosiasi", tasks: [] },
  { name: "Pembukaan Rekening", tasks: [{ name: "Siapkan formulir" }] },
];

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

async function insertProspect(name: string, officer: Officer = rina): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into prospect (name, name_key, funding_officer_id) values (${name}, ${name.toLowerCase()}, ${officer.id})
    returning id`;
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

async function createTemplate(name: string, stages = STAGES): Promise<Template> {
  const response = await templatesRoute.POST(
    request("/api/pipeline-templates", "POST", { body: { name, stages }, headers: { "Idempotency-Key": randomUUID() } }),
  );
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
  return (await response.json()) as Template;
}

async function getTemplate(id: string): Promise<Template> {
  return (await (await templateRoute.GET(request(`/api/pipeline-templates/${id}`, "GET"), ctx(id))).json()) as Template;
}

function start(body: unknown, key: string = randomUUID(), headers: Record<string, string> = {}) {
  return pipelinesRoute.POST(request("/api/pipelines", "POST", { body, headers: { "Idempotency-Key": key, ...headers } }));
}

async function startOk(prospectId: string, templateId = template.id): Promise<Pipeline> {
  const response = await start({ prospectId, templateId });
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
  return (await response.json()) as Pipeline;
}

function get(id: string) {
  return pipelineRoute.GET(request(`/api/pipelines/${id}`, "GET"), ctx(id));
}

async function getOk(id: string): Promise<Pipeline> {
  const response = await get(id);
  expect(response.status).toBe(200);
  return (await response.json()) as Pipeline;
}

function move(id: string, stagePosition: unknown, version: number, headers: Record<string, string> = {}) {
  return moveRoute.POST(request(`/api/pipelines/${id}/move`, "POST", { body: { stagePosition, version }, headers }), ctx(id));
}

function outcome(id: string, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return outcomeRoute.POST(request(`/api/pipelines/${id}/outcome`, "POST", { body, headers }), ctx(id));
}

async function outcomeOk(id: string, body: Record<string, unknown>): Promise<Pipeline> {
  const response = await outcome(id, body);
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
  return (await response.json()) as Pipeline;
}

function reopen(id: string, version: number, headers: Record<string, string> = {}) {
  return reopenRoute.POST(request(`/api/pipelines/${id}/reopen`, "POST", { body: { version }, headers }), ctx(id));
}

function changeOfficer(id: string, fundingOfficerId: string, version: number, headers: Record<string, string> = {}) {
  return pipelineRoute.PATCH(
    request(`/api/pipelines/${id}`, "PATCH", { body: { fundingOfficerId, version }, headers }),
    ctx(id),
  );
}

function patchTask(id: string, body: unknown, headers: Record<string, string> = {}) {
  return taskRoute.PATCH(request(`/api/pipeline-tasks/${id}`, "PATCH", { body, headers }), ctx(id));
}

function deleteTask(id: string, headers: Record<string, string> = {}) {
  return taskRoute.DELETE(request(`/api/pipeline-tasks/${id}`, "DELETE", { headers }), ctx(id));
}

async function prospectVersion(id: string): Promise<number> {
  return ((await (await prospectRoute.GET(request(`/api/prospects/${id}`, "GET"), ctx(id))).json()) as { version: number }).version;
}

async function archiveProspect(id: string) {
  return prospectArchiveRoute.POST(
    request(`/api/prospects/${id}/archive`, "POST", { body: { version: await prospectVersion(id) } }),
    ctx(id),
  );
}

async function listRows(query = ""): Promise<{ items: Row[]; total: number }> {
  const response = await prospectsRoute.GET(request(`/api/prospects${query}`, "GET"));
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
  return (await response.json()) as { items: Row[]; total: number };
}

function taskNamed(p: Pipeline, name: string): Task {
  const task = p.stages.flatMap((stage) => stage.tasks).find((item) => item.name === name);
  if (!task) throw new Error(`no task ${name}`);
  return task;
}

const WON = (version: number, extra: Record<string, unknown> = {}) => ({
  outcome: "won",
  accountsOpened: 350,
  wonOn: wibDate(),
  version,
  ...extra,
});

describe("E3-S3 Pipelines", () => {
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
    template = await createTemplate("Sekolah");
  });

  afterAll(async () => {
    await sql.end();
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
  });

  describe("criterion 1: starting copies the template's Stages and Tasks, starts at the first Stage, copies the Funding Officer (EC21)", () => {
    it("answers 201 with the full record and no-store", async () => {
      const prospectId = await insertProspect("SDN 3 Cibinong");
      const response = await start({ prospectId, templateId: template.id });
      expect(response.status).toBe(201);
      expect(response.headers.get("cache-control")).toContain("no-store");
      const body = (await response.json()) as Pipeline;
      expect(body).toMatchObject({
        prospect: { id: prospectId, name: "SDN 3 Cibinong", archived: false },
        template: { id: template.id, name: "Sekolah" },
        fundingOfficer: { id: rina.id, name: "Rina Kartika", active: true },
        outcome: null,
        accountsOpened: null,
        wonOn: null,
        lostReason: null,
        currentStagePosition: 1,
        currentStage: { position: 1, name: "Identifikasi" },
        stageCount: 5,
        tasksDone: 0,
        tasksTotal: 7,
        prospectHasOtherOpenPipeline: false,
        closedAt: null,
        version: 1,
      });
      expect(body.stages.map((stage) => [stage.position, stage.name, stage.tasks.map((task) => [task.position, task.name])])).toEqual([
        [1, "Identifikasi", [[1, "Kumpulkan data"], [2, "Tentukan Kontak"]]],
        [2, "Pendekatan", [[1, "Hubungi Kontak"]]],
        [3, "Presentasi", [[1, "Siapkan materi"], [2, "Presentasi"], [3, "Kirim proposal"]]],
        [4, "Negosiasi", []],
        [5, "Pembukaan Rekening", [[1, "Siapkan formulir"]]],
      ]);
      expect(body.stages[0].tasks[0]).toEqual({
        id: expect.any(String),
        position: 1,
        name: "Kumpulkan data",
        dueOn: null,
        done: false,
        doneAt: null,
        overdue: false,
        version: 1,
      });
      expect(await getOk(body.id)).toEqual(body);
    });

    it("keeps the Pipeline unchanged when the template is edited or archived afterwards", async () => {
      const prospectId = await insertProspect("SDN 3 Cibinong");
      const started = await startOk(prospectId);
      const saved = await templateRoute.PUT(
        request(`/api/pipeline-templates/${template.id}`, "PUT", {
          body: { name: "Sekolah Baru", stages: [{ name: "Satu-satunya", tasks: [{ name: "Tugas baru" }] }], version: 1 },
        }),
        ctx(template.id),
      );
      expect(saved.status).toBe(200);
      const after = await getOk(started.id);
      expect(after.stages).toEqual(started.stages);
      expect(after.stageCount).toBe(5);
      // The template's own name is shown live; its Stages are not.
      expect(after.template.name).toBe("Sekolah Baru");
      await createTemplate("Pasar");
      const archived = await templateArchiveRoute.POST(
        request(`/api/pipeline-templates/${template.id}/archive`, "POST", { body: { version: 2 } }),
        ctx(template.id),
      );
      expect(archived.status).toBe(200);
      expect((await getOk(started.id)).stages).toEqual(started.stages);
    });

    it("copies the Prospect's Funding Officer, and a later change to the Prospect's does not change it", async () => {
      const prospectId = await insertProspect("Pasar Anyar", agus);
      const started = await startOk(prospectId);
      expect(started.fundingOfficer.id).toBe(agus.id);
      const patched = await prospectRoute.PATCH(
        request(`/api/prospects/${prospectId}`, "PATCH", { body: { fundingOfficerId: rina.id, version: 1 } }),
        ctx(prospectId),
      );
      expect(patched.status).toBe(200);
      expect((await getOk(started.id)).fundingOfficer.id).toBe(agus.id);
    });

    it("is idempotent: a repeat with the same key answers 200 with the same Pipeline and starts nothing new", async () => {
      const prospectId = await insertProspect("SDN 3 Cibinong");
      const key = randomUUID();
      const first = await start({ prospectId, templateId: template.id }, key);
      expect(first.status).toBe(201);
      const again = await start({ prospectId, templateId: template.id }, key);
      expect(again.status).toBe(200);
      expect(((await again.json()) as Pipeline).id).toBe(((await first.json()) as Pipeline).id);
      expect((await sql`select 1 from pipeline`).length).toBe(1);
      expect((await sql`select scope from idempotency_key where key = ${key}`)[0].scope).toBe(START_SCOPE);
    });

    it("refuses an archived template, an unknown template, an unknown Prospect and an inactive Funding Officer with 422", async () => {
      const prospectId = await insertProspect("SDN 3 Cibinong");
      const other = await createTemplate("Pasar");
      await templateArchiveRoute.POST(
        request(`/api/pipeline-templates/${other.id}/archive`, "POST", { body: { version: 1 } }),
        ctx(other.id),
      );
      const archived = await start({ prospectId, templateId: other.id });
      expect(archived.status).toBe(422);
      expect(await errorOf(archived)).toEqual({
        code: "template_archived_cannot_start",
        message: "Template ini diarsipkan dan tidak bisa dipakai untuk Pipeline baru.",
      });
      const unknownTemplate = await start({ prospectId, templateId: MISSING_ID });
      expect((await errorOf(unknownTemplate)).code).toBe("template_not_found");
      const unknownProspect = await start({ prospectId: MISSING_ID, templateId: template.id });
      expect(unknownProspect.status).toBe(422);
      expect(await errorOf(unknownProspect)).toEqual({ code: "prospect_not_found", message: "Prospect tidak ditemukan." });
      expect((await errorOf(await start({ prospectId: "bukan-uuid", templateId: template.id }))).code).toBe("prospect_not_found");

      await sql`update funding_officer set active = false where id = ${rina.id}`;
      const inactive = await start({ prospectId, templateId: template.id });
      expect(inactive.status).toBe(422);
      expect(await errorOf(inactive)).toEqual({ code: "funding_officer_inactive", message: "Funding Officer ini sudah nonaktif." });
      expect((await sql`select 1 from pipeline`).length).toBe(0);
    });

    it("answers 400 for a missing field, a missing key, and 403 cross-origin", async () => {
      const missing = await start({ templateId: template.id });
      expect(missing.status).toBe(400);
      expect((await errorOf(missing)).fields).toEqual({ prospectId: "Wajib diisi." });
      const noKey = await pipelinesRoute.POST(request("/api/pipelines", "POST", { body: { prospectId: MISSING_ID, templateId: template.id } }));
      expect((await errorOf(noKey)).code).toBe("idempotency_key");
      const cross = await start({ prospectId: MISSING_ID, templateId: template.id }, randomUUID(), { origin: "https://jahat.example" });
      expect(cross.status).toBe(403);
    });
  });

  describe("criterion 2: a second open or On Hold Pipeline, or an archived Prospect, is refused (EC16)", () => {
    it("refuses a second Pipeline while one is open, and while it is On Hold, with the exact 409", async () => {
      const prospectId = await insertProspect("SDN 3 Cibinong");
      const first = await startOk(prospectId);
      const second = await start({ prospectId, templateId: template.id });
      expect(second.status).toBe(409);
      expect(await errorOf(second)).toEqual({ code: "pipeline_already_open", message: ALREADY_OPEN });
      await outcomeOk(first.id, { outcome: "on_hold", version: 1 });
      const onHold = await start({ prospectId, templateId: template.id });
      expect(onHold.status).toBe(409);
      expect((await errorOf(onHold)).message).toBe(ALREADY_OPEN);
      expect((await sql`select 1 from pipeline`).length).toBe(1);
    });

    it("allows a new Pipeline once the previous one is Won or Lost", async () => {
      const prospectId = await insertProspect("SDN 3 Cibinong");
      const first = await startOk(prospectId);
      await outcomeOk(first.id, { outcome: "lost", lostReason: "Sudah pakai bank lain.", version: 1 });
      const second = await startOk(prospectId);
      expect(second.id).not.toBe(first.id);
    });

    it("refuses an archived Prospect with 422 prospect_archived and the archived message", async () => {
      const prospectId = await insertProspect("SDN 3 Cibinong");
      await sql`update prospect set archived_at = now() where id = ${prospectId}`;
      const response = await start({ prospectId, templateId: template.id });
      expect(response.status).toBe(422);
      expect(await errorOf(response)).toEqual({ code: "prospect_archived", message: ARCHIVED });
    });

    it("starts exactly one Pipeline when two starts race with different keys", async () => {
      const prospectId = await insertProspect("SDN 3 Cibinong");
      const responses = await Promise.all([1, 2, 3].map(() => start({ prospectId, templateId: template.id })));
      expect(responses.map((response) => response.status).sort()).toEqual([201, 409, 409]);
      expect((await sql`select 1 from pipeline where prospect_id = ${prospectId}`).length).toBe(1);
    });

    it("is backed by the partial unique index in the database", async () => {
      const prospectId = await insertProspect("SDN 3 Cibinong");
      await startOk(prospectId);
      await expect(
        sql`insert into pipeline (prospect_id, template_id, funding_officer_id, outcome)
            values (${prospectId}, ${template.id}, ${rina.id}, 'on_hold')`,
      ).rejects.toMatchObject({ code: "23505", constraint_name: "pipeline_one_open_per_prospect_idx" });
    });
  });

  describe("criterion 3: an open Pipeline moves to any Stage; a forward move counts unticked Tasks left behind (EC23)", () => {
    it("moves forward, reporting unticked Tasks in the Stages it leaves behind", async () => {
      const started = await startOk(await insertProspect("SDN 3 Cibinong"));
      await patchTask(taskNamed(started, "Kumpulkan data").id, { done: true, version: 1 });
      // Leaving Identifikasi (1 of 2 unticked) and Pendekatan (1 unticked) for Presentasi.
      const response = await move(started.id, 3, 1);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("no-store");
      const body = (await response.json()) as { pipeline: Pipeline; uncheckedTasksLeftBehind: number };
      expect(body.uncheckedTasksLeftBehind).toBe(2);
      expect(body.pipeline).toMatchObject({ currentStagePosition: 3, currentStage: { name: "Presentasi" }, version: 2 });
      // Presentasi (3 unticked) and Negosiasi (none) are left behind on the way to the last Stage.
      const last = (await (await move(started.id, 5, 2)).json()) as { uncheckedTasksLeftBehind: number };
      expect(last.uncheckedTasksLeftBehind).toBe(3);
    });

    it("moves back, and to the current Stage, reporting 0; the current Stage is a no-op", async () => {
      const started = await startOk(await insertProspect("SDN 3 Cibinong"));
      await move(started.id, 4, 1);
      const back = (await (await move(started.id, 1, 2)).json()) as { pipeline: Pipeline; uncheckedTasksLeftBehind: number };
      expect(back).toMatchObject({ uncheckedTasksLeftBehind: 0, pipeline: { currentStagePosition: 1, version: 3 } });
      const same = await move(started.id, 1, 1);
      expect(same.status).toBe(200);
      expect((await same.json()) as unknown).toMatchObject({ uncheckedTasksLeftBehind: 0, pipeline: { currentStagePosition: 1, version: 3 } });
    });

    it("refuses a Stage the Pipeline does not have (400), a stale version (409) and an unknown id (404)", async () => {
      const started = await startOk(await insertProspect("SDN 3 Cibinong"));
      const beyond = await move(started.id, 6, 1);
      expect(beyond.status).toBe(400);
      expect((await errorOf(beyond)).fields).toEqual({ stagePosition: "Tahap ini tidak ada di Pipeline ini." });
      for (const bad of [0, 1.5, "2"]) expect((await move(started.id, bad, 1)).status).toBe(400);
      await move(started.id, 2, 1);
      const stale = await move(started.id, 3, 1);
      expect(stale.status).toBe(409);
      expect((await errorOf(stale)).code).toBe("version_conflict");
      expect((await move(MISSING_ID, 2, 1)).status).toBe(404);
      expect((await move("bukan-uuid", 2, 1)).status).toBe(404);
    });

    it("refuses moving a Won, Lost or On Hold Pipeline with 422 pipeline_closed", async () => {
      for (const body of [
        { outcome: "on_hold" },
        { outcome: "lost", lostReason: "Tidak berminat." },
        { outcome: "won", accountsOpened: 10, wonOn: wibDate() },
      ]) {
        const started = await startOk(await insertProspect(`Prospect ${body.outcome}`));
        await outcomeOk(started.id, { ...body, version: 1 });
        const response = await move(started.id, 2, 2);
        expect(response.status, body.outcome).toBe(422);
        expect(await errorOf(response)).toEqual({
          code: "pipeline_closed",
          message: "Pipeline ini sudah selesai atau ditunda. Tahapnya tidak bisa diubah.",
        });
      }
    });
  });

  describe("criterion 4: Tasks can be ticked, unticked, given a due date and removed from one Pipeline (EC22)", () => {
    it("ticks and unticks a Task with its own version, answering the whole Pipeline", async () => {
      const started = await startOk(await insertProspect("SDN 3 Cibinong"));
      const task = taskNamed(started, "Kumpulkan data");
      const ticked = await patchTask(task.id, { done: true, version: 1 });
      expect(ticked.status).toBe(200);
      const afterTick = (await ticked.json()) as Pipeline;
      expect(taskNamed(afterTick, "Kumpulkan data")).toMatchObject({ done: true, doneAt: expect.any(String), version: 2 });
      expect(afterTick).toMatchObject({ tasksDone: 1, version: 1 });
      expect(afterTick.stages[0]).toMatchObject({ tasksDone: 1, tasksTotal: 2 });
      // Ticking it again changes nothing and does not check the version: a double tap is harmless.
      const again = await patchTask(task.id, { done: true, version: 1 });
      expect(again.status).toBe(200);
      expect(taskNamed((await again.json()) as Pipeline, "Kumpulkan data").version).toBe(2);
      const unticked = (await (await patchTask(task.id, { done: false, version: 2 })).json()) as Pipeline;
      expect(taskNamed(unticked, "Kumpulkan data")).toMatchObject({ done: false, doneAt: null, version: 3 });
    });

    it("sets and clears a due date; a real change with a stale version is 409, so no edit is lost silently", async () => {
      const started = await startOk(await insertProspect("SDN 3 Cibinong"));
      const task = taskNamed(started, "Hubungi Kontak");
      const dated = (await (await patchTask(task.id, { dueOn: "2026-12-01", version: 1 })).json()) as Pipeline;
      expect(taskNamed(dated, "Hubungi Kontak")).toMatchObject({ dueOn: "2026-12-01", version: 2 });
      const stale = await patchTask(task.id, { done: true, version: 1 });
      expect(stale.status).toBe(409);
      expect((await errorOf(stale)).code).toBe("version_conflict");
      const both = (await (await patchTask(task.id, { done: true, dueOn: null, version: 2 })).json()) as Pipeline;
      expect(taskNamed(both, "Hubungi Kontak")).toMatchObject({ dueOn: null, done: true, version: 3 });
    });

    it("validates the body: a real calendar date, a boolean, a version", async () => {
      const started = await startOk(await insertProspect("SDN 3 Cibinong"));
      const id = taskNamed(started, "Hubungi Kontak").id;
      for (const [body, field] of [
        [{ dueOn: "2026-02-30", version: 1 }, "dueOn"],
        [{ dueOn: "01-12-2026", version: 1 }, "dueOn"],
        [{ done: "ya", version: 1 }, "done"],
        [{ done: true }, "version"],
      ] as const) {
        const response = await patchTask(id, body);
        expect(response.status, JSON.stringify(body)).toBe(400);
        expect(Object.keys((await errorOf(response)).fields ?? {})).toEqual([field]);
      }
      expect((await errorOf(await patchTask(id, { dueOn: "2026-02-30", version: 1 }))).fields).toEqual({ dueOn: "Tanggal tidak valid." });
      expect((await patchTask(MISSING_ID, { done: true, version: 1 })).status).toBe(404);
    });

    it("removes a Task from one Pipeline only: the template and other Pipelines keep it", async () => {
      const first = await startOk(await insertProspect("SDN 3 Cibinong"));
      const second = await startOk(await insertProspect("SDN 5 Cibinong"));
      const response = await deleteTask(taskNamed(first, "Kirim proposal").id);
      expect(response.status).toBe(204);
      expect(await response.text()).toBe("");
      const after = await getOk(first.id);
      expect(after.stages[2].tasks.map((task) => task.name)).toEqual(["Siapkan materi", "Presentasi"]);
      expect(after.tasksTotal).toBe(6);
      expect((await getOk(second.id)).stages[2].tasks.map((task) => task.name)).toEqual(["Siapkan materi", "Presentasi", "Kirim proposal"]);
      expect((await getTemplate(template.id)).stages[2].tasks.map((task) => task.name)).toEqual(["Siapkan materi", "Presentasi", "Kirim proposal"]);
      expect((await deleteTask(taskNamed(first, "Kirim proposal").id)).status).toBe(404);
      expect((await deleteTask("bukan-uuid")).status).toBe(404);
    });

    it("refuses Task edits and removal on a Won, Lost or On Hold Pipeline with 422 pipeline_closed", async () => {
      for (const body of [
        { outcome: "on_hold" },
        { outcome: "lost", lostReason: "Tidak berminat." },
        { outcome: "won", accountsOpened: 10, wonOn: wibDate() },
      ]) {
        const started = await startOk(await insertProspect(`Prospect ${body.outcome}`));
        await outcomeOk(started.id, { ...body, version: 1 });
        const id = taskNamed(started, "Kumpulkan data").id;
        const ticking = await patchTask(id, { done: true, version: 1 });
        expect(ticking.status, body.outcome).toBe(422);
        expect(await errorOf(ticking)).toEqual({
          code: "pipeline_closed",
          message: "Pipeline ini sudah selesai atau ditunda. Tugasnya tidak bisa diubah.",
        });
        expect((await deleteTask(id)).status).toBe(422);
      }
    });
  });

  describe("criterion 5: the Outcome transitions (EC10, EC24, EC32)", () => {
    it("Open → Won with Accounts Opened and the Won date sets closedAt", async () => {
      const started = await startOk(await insertProspect("SDN 3 Cibinong"));
      const won = await outcomeOk(started.id, WON(1, { wonOn: "2026-11-18" }));
      expect(won).toMatchObject({ outcome: "won", accountsOpened: 350, wonOn: "2026-11-18", lostReason: null, closedAt: expect.any(String), version: 2 });
    });

    it("Open → Lost with a reason; Open → On Hold; On Hold → Open at the same Stage; On Hold → Lost", async () => {
      const lost = await startOk(await insertProspect("A"));
      expect(await outcomeOk(lost.id, { outcome: "lost", lostReason: "  Sudah pakai bank lain.  ", version: 1 })).toMatchObject({
        outcome: "lost",
        lostReason: "Sudah pakai bank lain.",
        closedAt: expect.any(String),
      });

      const held = await startOk(await insertProspect("B"));
      await move(held.id, 3, 1);
      expect(await outcomeOk(held.id, { outcome: "on_hold", version: 2 })).toMatchObject({ outcome: "on_hold", closedAt: null, version: 3 });
      expect(await outcomeOk(held.id, { outcome: "open", version: 3 })).toMatchObject({ outcome: null, currentStagePosition: 3, version: 4 });
      await outcomeOk(held.id, { outcome: "on_hold", version: 4 });
      expect(await outcomeOk(held.id, { outcome: "lost", lostReason: "Ditunda terlalu lama.", version: 5 })).toMatchObject({
        outcome: "lost",
        closedAt: expect.any(String),
      });
    });

    it("rejects every other transition with 422 invalid_transition", async () => {
      const cases: [string, Record<string, unknown>[], Record<string, unknown>][] = [
        ["open → open", [], { outcome: "open" }],
        ["on hold → on hold", [{ outcome: "on_hold" }], { outcome: "on_hold" }],
        ["on hold → won", [{ outcome: "on_hold" }], { outcome: "won", accountsOpened: 5, wonOn: wibDate() }],
        ["won → lost", [WON(0)], { outcome: "lost", lostReason: "x" }],
        ["won → open", [WON(0)], { outcome: "open" }],
        ["won → on hold", [WON(0)], { outcome: "on_hold" }],
        ["won → won", [WON(0)], { outcome: "won", accountsOpened: 5, wonOn: wibDate() }],
        ["lost → won", [{ outcome: "lost", lostReason: "x" }], { outcome: "won", accountsOpened: 5, wonOn: wibDate() }],
        ["lost → open", [{ outcome: "lost", lostReason: "x" }], { outcome: "open" }],
        ["lost → on hold", [{ outcome: "lost", lostReason: "x" }], { outcome: "on_hold" }],
      ];
      for (const [label, steps, last] of cases) {
        const started = await startOk(await insertProspect(label));
        let version = 1;
        for (const step of steps) version = (await outcomeOk(started.id, { ...step, version })).version;
        const response = await outcome(started.id, { ...last, version });
        expect(response.status, label).toBe(422);
        const error = await errorOf(response);
        expect(error.code, label).toBe("invalid_transition");
        expect(error.message, label).toMatch(/^Hasil Pipeline tidak bisa diubah dari \S+ ke \S+\.$/);
      }
      const started = await startOk(await insertProspect("Pesan"));
      await outcomeOk(started.id, WON(1));
      expect((await errorOf(await outcome(started.id, { outcome: "lost", lostReason: "x", version: 2 }))).message).toBe(
        "Hasil Pipeline tidak bisa diubah dari Berhasil ke Gagal.",
      );
    });

    it("validates Accounts Opened: an integer from 1 to 100,000, with the exact message", async () => {
      const started = await startOk(await insertProspect("SDN 3 Cibinong"));
      for (const value of [0, 100001, 1.5, -3, "10", null, undefined]) {
        const response = await outcome(started.id, WON(1, { accountsOpened: value }));
        expect(response.status, String(value)).toBe(400);
        expect((await errorOf(response)).fields, String(value)).toEqual({ accountsOpened: ACCOUNTS_OPENED_MESSAGE });
      }
      expect(ACCOUNTS_OPENED_MESSAGE).toBe("Rekening dibuka harus bilangan bulat 1 sampai 100.000.");
      expect(pipelineOutcomeInput.safeParse(WON(1, { accountsOpened: 1 })).success).toBe(true);
      expect((await outcomeOk(started.id, WON(1, { accountsOpened: 100000 }))).accountsOpened).toBe(100000);
      const other = await startOk(await insertProspect("SDN 5 Cibinong"));
      expect((await outcomeOk(other.id, WON(1, { accountsOpened: 1 }))).accountsOpened).toBe(1);
    });

    it("requires the Won date, a real date", async () => {
      const started = await startOk(await insertProspect("SDN 3 Cibinong"));
      const missing = await outcome(started.id, WON(1, { wonOn: undefined }));
      expect((await errorOf(missing)).fields).toEqual({ wonOn: "Wajib diisi." });
      const bad = await outcome(started.id, WON(1, { wonOn: "2026-13-01" }));
      expect((await errorOf(bad)).fields).toEqual({ wonOn: "Tanggal tidak valid." });
    });

    it("judges a future Won date in WIB: at 2026-01-31T17:30Z it is already 1 February in WIB", async () => {
      const now = new Date("2026-01-31T17:30:00Z");
      expect(wibDate(now)).toBe("2026-02-01");
      const input = (wonOn: string) => pipelineOutcomeInput.parse({ outcome: "won", accountsOpened: 12, wonOn, version: 1 });

      const tomorrow = await startOk(await insertProspect("Besok"));
      await expect(setPipelineOutcome(tomorrow.id, input("2026-02-02"), { now })).rejects.toMatchObject({
        status: 400,
        code: "validation",
        fields: { wonOn: WON_ON_FUTURE_MESSAGE },
      });
      expect(WON_ON_FUTURE_MESSAGE).toBe("Tanggal berhasil tidak boleh di masa depan.");

      const today = await startOk(await insertProspect("Hari ini"));
      expect(await setPipelineOutcome(today.id, input("2026-02-01"), { now })).toMatchObject({ outcome: "won", wonOn: "2026-02-01" });
      const yesterday = await startOk(await insertProspect("Kemarin"));
      expect(await setPipelineOutcome(yesterday.id, input("2026-01-31"), { now })).toMatchObject({ wonOn: "2026-01-31" });

      // Through the route with the real clock: tomorrow in WIB is refused.
      const route = await startOk(await insertProspect("Rute"));
      const next = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const response = await outcome(route.id, WON(1, { wonOn: wibDate(next) }));
      expect(response.status).toBe(400);
      expect((await errorOf(response)).fields).toEqual({ wonOn: WON_ON_FUTURE_MESSAGE });
    });

    it("requires a Lost reason: free text up to 500 characters, with the customer-number guard", async () => {
      const started = await startOk(await insertProspect("SDN 3 Cibinong"));
      for (const [lostReason, message] of [
        [undefined, "Wajib diisi."],
        ["   ", "Wajib diisi."],
        ["a".repeat(501), "Maksimal 500 karakter."],
        ["Nasabah NIK 3201 2345 6789 0001", GUARD],
        ["Rekening 1234567890", GUARD],
      ] as const) {
        const response = await outcome(started.id, { outcome: "lost", lostReason, version: 1 });
        expect(response.status, String(lostReason)).toBe(400);
        expect((await errorOf(response)).fields).toEqual({ lostReason: message });
      }
      expect((await outcomeOk(started.id, { outcome: "lost", lostReason: "a".repeat(500), version: 1 })).lostReason).toHaveLength(500);
    });

    it("rejects an unknown outcome (400), a stale version (409) and an unknown id (404)", async () => {
      const started = await startOk(await insertProspect("SDN 3 Cibinong"));
      const unknown = await outcome(started.id, { outcome: "batal", version: 1 });
      expect(unknown.status).toBe(400);
      expect((await errorOf(unknown)).fields).toEqual({ outcome: "Isian tidak valid." });
      expect((await errorOf(await outcome(started.id, { version: 1 }))).fields).toEqual({ outcome: "Wajib diisi." });
      await outcomeOk(started.id, { outcome: "on_hold", version: 1 });
      const stale = await outcome(started.id, { outcome: "open", version: 1 });
      expect(stale.status).toBe(409);
      expect((await outcome(MISSING_ID, { outcome: "on_hold", version: 1 })).status).toBe(404);
    });

    it("is enforced by check constraints in the database too", async () => {
      const prospectId = await insertProspect("SDN 3 Cibinong");
      for (const values of [
        sql`'won', null, '2026-11-18', null, now()`,
        sql`'won', 0, '2026-11-18', null, now()`,
        sql`'lost', null, null, null, now()`,
        sql`'on_hold', 5, null, null, null`,
        sql`null, null, null, null, now()`,
      ]) {
        await expect(
          sql`insert into pipeline (prospect_id, template_id, funding_officer_id, outcome, accounts_opened, won_on, lost_reason, closed_at)
              values (${prospectId}, ${template.id}, ${rina.id}, ${values})`,
        ).rejects.toMatchObject({ code: "23514" });
      }
    });
  });

  describe("criterion 6: reopening a Won or Lost Pipeline clears its Outcome (EC25)", () => {
    it("reopens a Won Pipeline at its Stage, clearing Outcome, Accounts Opened, Won date and closedAt", async () => {
      const started = await startOk(await insertProspect("SDN 3 Cibinong"));
      await move(started.id, 5, 1);
      await outcomeOk(started.id, WON(2));
      const response = await reopen(started.id, 3);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        outcome: null,
        accountsOpened: null,
        wonOn: null,
        lostReason: null,
        closedAt: null,
        currentStagePosition: 5,
        version: 4,
      });
    });

    it("reopens a Lost Pipeline, clearing the reason", async () => {
      const started = await startOk(await insertProspect("SDN 3 Cibinong"));
      await move(started.id, 3, 1);
      await outcomeOk(started.id, { outcome: "lost", lostReason: "Tidak berminat.", version: 2 });
      const reopened = (await (await reopen(started.id, 3)).json()) as Pipeline;
      expect(reopened).toMatchObject({ outcome: null, lostReason: null, closedAt: null, currentStage: { name: "Presentasi" } });
    });

    it("is refused with 409 when the Prospect has another open or On Hold Pipeline", async () => {
      const prospectId = await insertProspect("SDN 3 Cibinong");
      const first = await startOk(prospectId);
      await outcomeOk(first.id, WON(1));
      const second = await startOk(prospectId);
      expect((await getOk(first.id)).prospectHasOtherOpenPipeline).toBe(true);
      const blocked = await reopen(first.id, 2);
      expect(blocked.status).toBe(409);
      expect(await errorOf(blocked)).toEqual({ code: "pipeline_already_open", message: "Prospect ini sudah punya Pipeline berjalan." });
      await outcomeOk(second.id, { outcome: "on_hold", version: 1 });
      expect((await reopen(first.id, 2)).status).toBe(409);
      await outcomeOk(second.id, { outcome: "lost", lostReason: "Tidak jadi.", version: 2 });
      expect((await getOk(first.id)).prospectHasOtherOpenPipeline).toBe(false);
      expect((await reopen(first.id, 2)).status).toBe(200);
    });

    it("is refused for an open or On Hold Pipeline (422), an archived Prospect (422), a stale version (409)", async () => {
      const prospectId = await insertProspect("SDN 3 Cibinong");
      const started = await startOk(prospectId);
      const open = await reopen(started.id, 1);
      expect(open.status).toBe(422);
      expect(await errorOf(open)).toEqual({ code: "invalid_transition", message: "Hanya Pipeline yang berhasil atau gagal yang bisa dibuka kembali." });
      await outcomeOk(started.id, { outcome: "on_hold", version: 1 });
      expect((await errorOf(await reopen(started.id, 2))).code).toBe("invalid_transition");
      await outcomeOk(started.id, { outcome: "lost", lostReason: "Tidak jadi.", version: 2 });
      expect((await reopen(started.id, 1)).status).toBe(409);
      expect((await archiveProspect(prospectId)).status).toBe(200);
      const archived = await reopen(started.id, 3);
      expect(archived.status).toBe(422);
      expect(await errorOf(archived)).toEqual({ code: "prospect_archived", message: ARCHIVED });
    });
  });

  describe("criterion 7: a Pipeline's Funding Officer changes separately from its Prospect's (EC26)", () => {
    it("changes only the Pipeline's Funding Officer", async () => {
      const prospectId = await insertProspect("SDN 3 Cibinong");
      const started = await startOk(prospectId);
      const response = await changeOfficer(started.id, agus.id, 1);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ fundingOfficer: { id: agus.id, name: "Agus Setiawan", active: true }, version: 2 });
      const [row] = await sql`select funding_officer_id from prospect where id = ${prospectId}`;
      expect(row.funding_officer_id).toBe(rina.id);
    });

    it("refuses an inactive or unknown Funding Officer (422), but keeps an unchanged inactive one; 409 when stale", async () => {
      const started = await startOk(await insertProspect("SDN 3 Cibinong"));
      const citra = await insertOfficer("Citra", false);
      const inactive = await changeOfficer(started.id, citra.id, 1);
      expect(inactive.status).toBe(422);
      expect((await errorOf(inactive)).code).toBe("funding_officer_inactive");
      expect((await errorOf(await changeOfficer(started.id, MISSING_ID, 1))).code).toBe("funding_officer_not_found");
      await sql`update funding_officer set active = false where id = ${rina.id}`;
      expect((await changeOfficer(started.id, rina.id, 1)).status).toBe(200);
      expect((await changeOfficer(started.id, agus.id, 1)).status).toBe(409);
    });

    it("is allowed On Hold, and refused on a Won or Lost Pipeline with 422 pipeline_closed", async () => {
      const held = await startOk(await insertProspect("A"));
      await outcomeOk(held.id, { outcome: "on_hold", version: 1 });
      expect((await changeOfficer(held.id, agus.id, 2)).status).toBe(200);
      const won = await startOk(await insertProspect("B"));
      await outcomeOk(won.id, WON(1));
      const refused = await changeOfficer(won.id, agus.id, 2);
      expect(refused.status).toBe(422);
      expect(await errorOf(refused)).toEqual({ code: "pipeline_closed", message: "Pipeline ini sudah selesai. Buka kembali dulu untuk mengubahnya." });
    });
  });

  describe("criterion 8: archiving a Prospect with an open Pipeline is refused; On Hold is allowed (EC19)", () => {
    it("refuses with 422 prospect_has_open_pipeline and the exact message while the Pipeline is open", async () => {
      const prospectId = await insertProspect("SDN 3 Cibinong");
      await startOk(prospectId);
      const open = await archiveProspect(prospectId);
      expect(open.status).toBe(422);
      expect(await errorOf(open)).toEqual({ code: "prospect_has_open_pipeline", message: CLOSE_FIRST });
      const [row] = await sql`select archived_at from prospect where id = ${prospectId}`;
      expect(row.archived_at).toBeNull();
    });

    it("archives a Prospect whose Pipeline is On Hold, and the Pipeline cannot be resumed while archived", async () => {
      // Decided by the user on 2026-11-19: the brief's EC19 wins, so putting the Pipeline On Hold ("tunda") is a way out.
      const prospectId = await insertProspect("Pasar Kramat Jati Blok B");
      const started = await startOk(prospectId);
      await outcomeOk(started.id, { outcome: "on_hold", version: 1 });
      const archived = await archiveProspect(prospectId);
      expect(archived.status).toBe(200);
      const resumed = await outcome(started.id, { outcome: "open", version: 2 });
      expect(resumed.status).toBe(422);
      expect((await errorOf(resumed)).code).toBe("prospect_archived");
      expect((await getOk(started.id)).outcome).toBe("on_hold");
    });

    it("archives a Prospect whose Pipelines are all Won or Lost, and restores it", async () => {
      const prospectId = await insertProspect("SDN 3 Cibinong");
      const first = await startOk(prospectId);
      await outcomeOk(first.id, WON(1));
      const second = await startOk(prospectId);
      await outcomeOk(second.id, { outcome: "lost", lostReason: "Tidak jadi.", version: 1 });
      const archived = await archiveProspect(prospectId);
      expect(archived.status).toBe(200);
      expect((await getOk(first.id)).prospect.archived).toBe(true);
      const restored = await prospectRestoreRoute.POST(
        request(`/api/prospects/${prospectId}/restore`, "POST", { body: { version: await prospectVersion(prospectId) } }),
        ctx(prospectId),
      );
      expect(restored.status).toBe(200);
    });
  });

  describe("criterion 9: the Prospect list fills openPipeline and filters by Stage on the server", () => {
    it("fills openPipeline for an open or On Hold Pipeline, and null otherwise", async () => {
      const open = await insertProspect("A Terbuka");
      const held = await insertProspect("B Ditunda");
      const closed = await insertProspect("C Selesai");
      await insertProspect("D Kosong");
      const a = await startOk(open);
      await move(a.id, 3, 1);
      const b = await startOk(held);
      await move(b.id, 2, 1);
      await outcomeOk(b.id, { outcome: "on_hold", version: 2 });
      const c = await startOk(closed);
      await outcomeOk(c.id, WON(1));
      const rows = (await listRows()).items;
      expect(rows.map((row) => [row.name, row.openPipeline])).toEqual([
        ["A Terbuka", { stageName: "Presentasi", stagePosition: 3, stageCount: 5 }],
        ["B Ditunda", { stageName: "Pendekatan", stagePosition: 2, stageCount: 5 }],
        ["C Selesai", null],
        ["D Kosong", null],
      ]);
    });

    it("filters by template and Stage position, matching only the open or On Hold Pipeline's current Stage", async () => {
      const other = await createTemplate("Pasar", [{ name: "Survei", tasks: [] }, { name: "Presentasi", tasks: [] }, { name: "Tutup", tasks: [] }]);
      const a = await startOk(await insertProspect("A"));
      await move(a.id, 3, 1);
      const b = await startOk(await insertProspect("B"));
      await move(b.id, 3, 1);
      await outcomeOk(b.id, { outcome: "on_hold", version: 2 });
      const c = await startOk(await insertProspect("C"));
      await move(c.id, 3, 1);
      await outcomeOk(c.id, WON(2));
      const d = await startOk(await insertProspect("D"), other.id);
      await move(d.id, 3, 1);
      await startOk(await insertProspect("E"));

      const page = await listRows(`?templateId=${template.id}&stagePosition=3`);
      expect(page.items.map((row) => row.name)).toEqual(["A", "B"]);
      expect(page.total).toBe(2);
      expect((await listRows(`?templateId=${other.id}&stagePosition=3`)).items.map((row) => row.name)).toEqual(["D"]);
      expect((await listRows(`?templateId=${template.id}&stagePosition=1&q=e`)).items.map((row) => row.name)).toEqual(["E"]);
    });

    it("needs templateId and stagePosition together, each valid (400)", async () => {
      for (const [query, field] of [
        [`?templateId=${template.id}`, "stagePosition"],
        ["?stagePosition=2", "templateId"],
        ["?templateId=bukan-uuid&stagePosition=2", "templateId"],
        [`?templateId=${template.id}&stagePosition=0`, "stagePosition"],
        [`?templateId=${template.id}&stagePosition=31`, "stagePosition"],
      ]) {
        const response = await prospectsRoute.GET(request(`/api/prospects${query}`, "GET"));
        expect(response.status, query).toBe(400);
        expect(Object.keys((await errorOf(response)).fields ?? {}), query).toEqual([field]);
      }
    });

    it("stays under 500 ms with 2,000 Prospects and 2,000 Pipelines (median of 3 runs, each query shape)", async () => {
      await sql`
        insert into prospect (name, name_key, category, funding_officer_id, archived_at)
        select n, lower(n),
          (array['sekolah','pasar','perusahaan','instansi','komunitas','lainnya'])[1 + i % 6]::prospect_category,
          (array[${rina.id}, ${agus.id}]::uuid[])[1 + i % 2],
          case when i % 10 = 0 then now() else null end
        from (select i, (array['SDN ','Pasar ','PT ','Kantor ','Paguyuban '])[1 + i % 5] || 'Cibinong ' || i as n
              from generate_series(1, 2000) as i) as s`;
      // One Pipeline per Prospect: open for most, On Hold, Won or Lost for some; Stage 1 to 5.
      await sql`
        insert into pipeline (prospect_id, template_id, funding_officer_id, current_stage_position, outcome, accounts_opened, won_on, lost_reason, closed_at)
        select p.id, ${template.id}, p.funding_officer_id, 1 + r % 5,
          o, case when o = 'won' then 10 end, case when o = 'won' then current_date end,
          case when o = 'lost' then 'x' end, case when o in ('won', 'lost') then now() end
        from (select id, funding_officer_id, row_number() over (order by id) as r from prospect) as p,
          lateral (select (array[null, null, 'on_hold', 'won', 'lost'])[1 + p.r % 5]::pipeline_outcome as o) as x`;
      await sql`
        insert into pipeline_stage (pipeline_id, position, name)
        select p.id, s.position, s.name from pipeline p,
          (values (1, 'Identifikasi'), (2, 'Pendekatan'), (3, 'Presentasi'), (4, 'Negosiasi'), (5, 'Pembukaan Rekening')) as s(position, name)`;
      await sql`
        insert into pipeline_task (stage_id, position, name)
        select st.id, t, 'Tugas ' || t from pipeline_stage st, generate_series(1, 2) as t`;
      expect(Number((await sql`select count(*) from pipeline`)[0].count)).toBe(2000);
      await sql`analyze prospect; analyze pipeline; analyze pipeline_stage; analyze pipeline_task`.simple();

      const shapes = [
        {},
        { q: "cibinong 1" },
        { templateId: template.id, stagePosition: "3" },
        { q: "sdn", category: "sekolah", fundingOfficerId: agus.id, templateId: template.id, stagePosition: "2" },
        { archived: "1", page: "40" },
      ];
      const timings: Record<string, number> = {};
      for (const shape of shapes) {
        const query = prospectListQuery.parse(shape);
        const runs: number[] = [];
        for (let run = 0; run < 3; run++) {
          const begin = performance.now();
          const page = await listProspects(query);
          runs.push(performance.now() - begin);
          expect(page.pageSize).toBe(50);
        }
        const median = runs.sort((x, y) => x - y)[1];
        timings[JSON.stringify(shape)] = Math.round(median * 10) / 10;
        expect(median, JSON.stringify(shape)).toBeLessThan(500);
      }
      console.info("[E3-S3] list median ms with 2,000 Prospects and 2,000 Pipelines:", timings);
      const filled = (await listProspects(prospectListQuery.parse({}))).items.filter((row) => row.openPipeline !== null);
      expect(filled.length).toBeGreaterThan(0);
      expect(filled[0].openPipeline).toMatchObject({ stageCount: 5 });
    });
  });

  describe("reading: GET /api/pipelines/:id and GET /api/pipelines?prospectId=", () => {
    it("lists a Prospect's Pipelines newest first, with their Stage and Task counts", async () => {
      const prospectId = await insertProspect("SDN 3 Cibinong");
      const first = await startOk(prospectId);
      await move(first.id, 2, 1);
      await outcomeOk(first.id, WON(2, { accountsOpened: 40 }));
      await sql`update pipeline set started_at = now() - interval '1 day' where id = ${first.id}`;
      const second = await startOk(prospectId);
      await patchTask(taskNamed(second, "Kumpulkan data").id, { done: true, version: 1 });
      await startOk(await insertProspect("Lain"));

      const response = await pipelinesRoute.GET(request(`/api/pipelines?prospectId=${prospectId}`, "GET"));
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("no-store");
      const { items } = (await response.json()) as { items: Record<string, unknown>[] };
      expect(items).toEqual([
        {
          id: second.id,
          template: { id: template.id, name: "Sekolah" },
          fundingOfficer: { id: rina.id, name: "Rina Kartika", active: true },
          outcome: null,
          accountsOpened: null,
          wonOn: null,
          lostReason: null,
          currentStage: { position: 1, name: "Identifikasi" },
          stageCount: 5,
          tasksDone: 1,
          tasksTotal: 7,
          startedAt: expect.any(String),
          closedAt: null,
          version: 1,
        },
        expect.objectContaining({ id: first.id, outcome: "won", accountsOpened: 40, currentStage: { position: 2, name: "Pendekatan" } }),
      ]);
      const empty = await pipelinesRoute.GET(request(`/api/pipelines?prospectId=${MISSING_ID}`, "GET"));
      expect(await empty.json()).toEqual({ items: [] });
      const bad = await pipelinesRoute.GET(request("/api/pipelines", "GET"));
      expect(bad.status).toBe(400);
      expect((await errorOf(bad)).fields).toEqual({ prospectId: "Wajib diisi." });
      expect((await pipelinesRoute.GET(request("/api/pipelines?prospectId=x", "GET"))).status).toBe(400);
    });

    it("answers 404 for an unknown or malformed id", async () => {
      expect((await get(MISSING_ID)).status).toBe(404);
      expect((await get("bukan-uuid")).status).toBe(404);
    });

    it("marks a Task Overdue when its due date (WIB) has passed, it is unticked and the Pipeline is open (EC30)", async () => {
      const started = await startOk(await insertProspect("SDN 3 Cibinong"));
      const now = new Date("2026-01-31T17:30:00Z"); // 1 Feb 2026, 00:30 WIB
      const yesterday = taskNamed(started, "Kumpulkan data");
      const today = taskNamed(started, "Tentukan Kontak");
      const ticked = taskNamed(started, "Hubungi Kontak");
      await updatePipelineTask(yesterday.id, { dueOn: "2026-01-31", version: 1 }, { now });
      await updatePipelineTask(today.id, { dueOn: "2026-02-01", version: 1 }, { now });
      await updatePipelineTask(ticked.id, { dueOn: "2026-01-01", done: true, version: 1 }, { now });

      const read = await getPipeline(started.id, { db: getDb(), now });
      expect(taskNamed(read as unknown as Pipeline, "Kumpulkan data").overdue).toBe(true);
      expect(taskNamed(read as unknown as Pipeline, "Tentukan Kontak").overdue).toBe(false);
      expect(taskNamed(read as unknown as Pipeline, "Hubungi Kontak").overdue).toBe(false);
      // At 2026-01-31T16:59Z it is still 31 January in WIB, so the first is not overdue yet.
      const earlier = await getPipeline(started.id, { now: new Date("2026-01-31T16:59:00Z") });
      expect(taskNamed(earlier as unknown as Pipeline, "Kumpulkan data").overdue).toBe(false);
      // On Hold, Won or Lost: never Overdue.
      await outcomeOk(started.id, { outcome: "on_hold", version: 1 });
      const held = await getPipeline(started.id, { now });
      expect(taskNamed(held as unknown as Pipeline, "Kumpulkan data").overdue).toBe(false);
    });
  });

  describe("follow-up from E3-S1: a template in use (EC21)", () => {
    it("counts Pipelines per template, any Outcome, in the list and the record", async () => {
      const other = await createTemplate("Pasar");
      const a = await startOk(await insertProspect("A"));
      await outcomeOk(a.id, WON(1));
      await startOk(await insertProspect("B"));
      await startOk(await insertProspect("C"), other.id);
      expect(await countPipelinesUsingTemplate(getDb(), template.id)).toBe(2);
      expect((await getTemplate(template.id)).pipelineCount).toBe(2);
      const { items } = (await (await templatesRoute.GET(request("/api/pipeline-templates", "GET"))).json()) as {
        items: { id: string; pipelineCount: number }[];
      };
      expect(Object.fromEntries(items.map((item) => [item.id, item.pipelineCount]))).toEqual({ [template.id]: 2, [other.id]: 1 });
    });

    it("refuses deleting a template a Pipeline uses with 409 template_in_use, but archives it", async () => {
      await createTemplate("Pasar");
      await startOk(await insertProspect("A"));
      const response = await templateRoute.DELETE(request(`/api/pipeline-templates/${template.id}`, "DELETE"), ctx(template.id));
      expect(response.status).toBe(409);
      expect(await errorOf(response)).toEqual({ code: "template_in_use", message: "Template ini dipakai Pipeline. Arsipkan saja." });
      const archived = await templateArchiveRoute.POST(
        request(`/api/pipeline-templates/${template.id}/archive`, "POST", { body: { version: 1 } }),
        ctx(template.id),
      );
      expect(archived.status).toBe(200);
      expect((await templateRoute.DELETE(request(`/api/pipeline-templates/${template.id}`, "DELETE"), ctx(template.id))).status).toBe(409);
      // The database backs it: the foreign key is ON DELETE restrict.
      await expect(sql`delete from pipeline_template where id = ${template.id}`).rejects.toMatchObject({ code: "23503" });
    });
  });

  describe("every route: session, Origin, error shape", () => {
    it("answers 401 without a session for every handler", async () => {
      const calls: (() => Promise<Response>)[] = [
        () => pipelinesRoute.GET(request(`/api/pipelines?prospectId=${MISSING_ID}`, "GET", { auth: false })),
        () => pipelinesRoute.POST(request("/api/pipelines", "POST", { auth: false, body: {} })),
        () => pipelineRoute.GET(request(`/api/pipelines/${MISSING_ID}`, "GET", { auth: false }), ctx(MISSING_ID)),
        () => pipelineRoute.PATCH(request(`/api/pipelines/${MISSING_ID}`, "PATCH", { auth: false, body: {} }), ctx(MISSING_ID)),
        () => moveRoute.POST(request(`/api/pipelines/${MISSING_ID}/move`, "POST", { auth: false, body: {} }), ctx(MISSING_ID)),
        () => outcomeRoute.POST(request(`/api/pipelines/${MISSING_ID}/outcome`, "POST", { auth: false, body: {} }), ctx(MISSING_ID)),
        () => reopenRoute.POST(request(`/api/pipelines/${MISSING_ID}/reopen`, "POST", { auth: false, body: {} }), ctx(MISSING_ID)),
        () => taskRoute.PATCH(request(`/api/pipeline-tasks/${MISSING_ID}`, "PATCH", { auth: false, body: {} }), ctx(MISSING_ID)),
        () => taskRoute.DELETE(request(`/api/pipeline-tasks/${MISSING_ID}`, "DELETE", { auth: false }), ctx(MISSING_ID)),
      ];
      for (const call of calls) {
        const response = await call();
        expect(response.status).toBe(401);
        expect((await errorOf(response)).code).toBe("unauthorized");
      }
    });

    it("refuses every mutation cross-origin with 403", async () => {
      const started = await startOk(await insertProspect("SDN 3 Cibinong"));
      const taskId = started.stages[0].tasks[0].id;
      const evil = { origin: "https://jahat.example" };
      for (const response of [
        await move(started.id, 2, 1, evil),
        await outcome(started.id, { outcome: "on_hold", version: 1 }, evil),
        await reopen(started.id, 1, evil),
        await changeOfficer(started.id, agus.id, 1, evil),
        await patchTask(taskId, { done: true, version: 1 }, evil),
        await deleteTask(taskId, evil),
      ]) {
        expect(response.status).toBe(403);
        expect((await errorOf(response)).code).toBe("forbidden_origin");
      }
      expect(await getOk(started.id)).toEqual(started);
    });

    it("has no DELETE for a Pipeline (EC22)", () => {
      expect("DELETE" in pipelineRoute).toBe(false);
    });
  });
});
