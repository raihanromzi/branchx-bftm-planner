// E3-S1: the Admin manages Pipeline Templates with ordered Stages and Tasks. A fresh database has the
// default template "Umum". A template no Pipeline uses can be deleted; one in use can only be archived.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "@/server/auth/password";
import { SESSION_COOKIE, hashSessionToken } from "@/server/auth/session";
import { getDb } from "@/server/db";
import {
  CREATE_SCOPE,
  PIPELINE_TEMPLATE_ARCHIVED_MESSAGE,
  TEMPLATE_CANNOT_START_MESSAGE,
  assertTemplateCanStartPipeline,
  countPipelinesUsingTemplate,
  createPipelineTemplateInput,
  getTemplateForSnapshot,
  updatePipelineTemplateInput,
} from "@/server/pipeline-templates";
import * as listRoute from "@/app/api/pipeline-templates/route";
import * as itemRoute from "@/app/api/pipeline-templates/[id]/route";
import * as archiveRoute from "@/app/api/pipeline-templates/[id]/archive/route";
import * as restoreRoute from "@/app/api/pipeline-templates/[id]/restore/route";
import { migrateTestDatabase, testDatabaseUrl, truncateAllTables } from "./support/test-db";

const root = join(__dirname, "..", "..");
const run = promisify(execFile);
const TEST_URL = testDatabaseUrl();
const ORIGIN = "http://localhost:3000";
const MISSING_ID = "00000000-0000-4000-8000-000000000000";
const GUARD = "Jangan tulis NIK atau nomor rekening nasabah.";
let sql: postgres.Sql;
let token: string;

type Task = { id: string; position: number; name: string };
type Stage = { id: string; position: number; name: string; tasks: Task[] };
type Template = {
  id: string;
  name: string;
  archived: boolean;
  archivedAt: string | null;
  pipelineCount: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  stages: Stage[];
};
type ListItem = {
  id: string;
  name: string;
  stageCount: number;
  pipelineCount: number;
  archived: boolean;
  version: number;
  updatedAt: string;
};
type ErrorBody = { error: { code: string; message: string; fields?: Record<string, string> } };
type StageInput = { name: string; tasks?: { name: string }[] };

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

const STAGES: StageInput[] = [
  { name: "Identifikasi", tasks: [{ name: "Kumpulkan data Prospect" }] },
  { name: "Presentasi", tasks: [{ name: "Siapkan materi" }, { name: "Kirim proposal" }] },
];

function valid(overrides: Record<string, unknown> = {}) {
  return { name: "Sekolah", stages: STAGES, ...overrides };
}

async function create(body: unknown, key: string = randomUUID(), headers: Record<string, string> = {}) {
  return listRoute.POST(request("/api/pipeline-templates", "POST", { body, headers: { "Idempotency-Key": key, ...headers } }));
}

async function createOk(overrides: Record<string, unknown> = {}): Promise<Template> {
  const response = await create(valid(overrides));
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
  return (await response.json()) as Template;
}

async function errorOf(response: Response) {
  return ((await response.json()) as ErrorBody).error;
}

async function list(): Promise<ListItem[]> {
  const response = await listRoute.GET(request("/api/pipeline-templates", "GET"));
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
  return ((await response.json()) as { items: ListItem[] }).items;
}

async function get(id: string) {
  return itemRoute.GET(request(`/api/pipeline-templates/${id}`, "GET"), ctx(id));
}

async function put(id: string, body: unknown, headers: Record<string, string> = {}) {
  return itemRoute.PUT(request(`/api/pipeline-templates/${id}`, "PUT", { body, headers }), ctx(id));
}

async function del(id: string, headers: Record<string, string> = {}) {
  return itemRoute.DELETE(request(`/api/pipeline-templates/${id}`, "DELETE", { headers }), ctx(id));
}

async function archive(id: string, version: number, headers: Record<string, string> = {}) {
  return archiveRoute.POST(request(`/api/pipeline-templates/${id}/archive`, "POST", { body: { version }, headers }), ctx(id));
}

async function restore(id: string, version: number, headers: Record<string, string> = {}) {
  return restoreRoute.POST(request(`/api/pipeline-templates/${id}/restore`, "POST", { body: { version }, headers }), ctx(id));
}

/** The template's Stages and Tasks as names only, in order. */
function outline(template: { stages: { name: string; tasks: { name: string }[] }[] }) {
  return template.stages.map((stage) => [stage.name, stage.tasks.map((task) => task.name)]);
}

function fieldsOf(schema: { safeParse: (v: unknown) => { error?: { issues: { path: PropertyKey[]; message: string }[] } } }, value: unknown) {
  const issues = schema.safeParse(value).error?.issues ?? [];
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const path = issue.path.map(String).join(".");
    if (!(path in fields)) fields[path] = issue.message;
  }
  return fields;
}

describe("E3-S1 Pipeline Templates", () => {
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

  describe("criterion 1: a name, at least one Stage, Stages in order, each with zero or more Tasks (EC3)", () => {
    it("creates a template, answering 201 with the full record, Stages and Tasks numbered from 1, with no-store", async () => {
      const response = await create({
        name: "  Sekolah  ",
        stages: [
          { name: " Identifikasi ", tasks: [{ name: " Kumpulkan data Prospect " }, { name: "Tentukan Kontak" }] },
          { name: "Presentasi" },
          { name: "Pembukaan Rekening", tasks: [] },
        ],
      });
      expect(response.status).toBe(201);
      expect(response.headers.get("cache-control")).toContain("no-store");
      const body = (await response.json()) as Template;
      expect(body).toEqual({
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        name: "Sekolah",
        archived: false,
        archivedAt: null,
        pipelineCount: 0,
        version: 1,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
        stages: [
          {
            id: expect.any(String),
            position: 1,
            name: "Identifikasi",
            tasks: [
              { id: expect.any(String), position: 1, name: "Kumpulkan data Prospect" },
              { id: expect.any(String), position: 2, name: "Tentukan Kontak" },
            ],
          },
          { id: expect.any(String), position: 2, name: "Presentasi", tasks: [] },
          { id: expect.any(String), position: 3, name: "Pembukaan Rekening", tasks: [] },
        ],
      });
    });

    it("rejects a template with no Stages with 'Tambahkan minimal satu Stage.' and saves nothing", async () => {
      for (const body of [valid({ stages: [] }), { name: "Sekolah" }]) {
        const response = await create(body);
        expect(response.status).toBe(400);
        expect(await errorOf(response)).toEqual({
          code: "validation",
          message: "Periksa kembali isian yang ditandai.",
          fields: { stages: "Tambahkan minimal satu Stage." },
        });
      }
      expect(fieldsOf(createPipelineTemplateInput, valid({ stages: [] }))).toEqual({ stages: "Tambahkan minimal satu Stage." });
      expect(fieldsOf(updatePipelineTemplateInput, { name: "A", stages: [], version: 1 })).toEqual({
        stages: "Tambahkan minimal satu Stage.",
      });
      expect((await sql`select 1 from pipeline_template`).length).toBe(0);
    });

    it("checks the template name: required, at most 100 characters, the customer-number guard", () => {
      expect(fieldsOf(createPipelineTemplateInput, valid({ name: "" }))).toEqual({ name: "Nama template wajib diisi." });
      expect(fieldsOf(createPipelineTemplateInput, valid({ name: "  " }))).toEqual({ name: "Nama template wajib diisi." });
      expect(fieldsOf(createPipelineTemplateInput, { stages: STAGES })).toEqual({ name: "Nama template wajib diisi." });
      expect(createPipelineTemplateInput.safeParse(valid({ name: "a".repeat(100) })).success).toBe(true);
      expect(fieldsOf(createPipelineTemplateInput, valid({ name: "a".repeat(101) }))).toEqual({ name: "Maksimal 100 karakter." });
      expect(fieldsOf(createPipelineTemplateInput, valid({ name: "Nasabah 3201234567890001" }))).toEqual({ name: GUARD });
    });

    it("checks Stage names (1 to 60) and Task names (1 to 120), keyed by their path, with the exact messages", () => {
      expect(
        createPipelineTemplateInput.safeParse(
          valid({ stages: [{ name: "a".repeat(60), tasks: [{ name: "b".repeat(120) }] }] }),
        ).success,
      ).toBe(true);
      expect(
        fieldsOf(
          createPipelineTemplateInput,
          valid({
            stages: [
              { name: "Identifikasi" },
              { name: "Pendekatan", tasks: [{ name: "Hubungi Kontak" }, { name: "  " }] },
              { name: " ", tasks: [{ name: "c".repeat(121) }] },
              { name: "d".repeat(61) },
              { name: "Rek 1234567890", tasks: [{ name: "NIK 3201 2345 6789 0001" }] },
              { tasks: [{}] },
            ],
          }),
        ),
      ).toEqual({
        "stages.1.tasks.1.name": "Nama Tugas wajib diisi.",
        "stages.2.name": "Nama Tahap wajib diisi.",
        "stages.2.tasks.0.name": "Maksimal 120 karakter.",
        "stages.3.name": "Maksimal 60 karakter.",
        "stages.4.name": GUARD,
        "stages.4.tasks.0.name": GUARD,
        "stages.5.name": "Nama Tahap wajib diisi.",
        "stages.5.tasks.0.name": "Nama Tugas wajib diisi.",
      });
    });

    it("answers 400 with the same field paths over HTTP", async () => {
      const response = await create(valid({ stages: [{ name: "Identifikasi" }, { name: "", tasks: [{ name: "" }] }] }));
      expect(response.status).toBe(400);
      expect((await errorOf(response)).fields).toEqual({
        "stages.1.name": "Nama Tahap wajib diisi.",
        "stages.1.tasks.0.name": "Nama Tugas wajib diisi.",
      });
    });

    it("allows at most 30 Stages and 30 Tasks per Stage", () => {
      const tasks = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `Tugas ${i + 1}` }));
      const stages = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `Tahap ${i + 1}`, tasks: tasks(30) }));
      expect(createPipelineTemplateInput.safeParse(valid({ stages: stages(30) })).success).toBe(true);
      expect(fieldsOf(createPipelineTemplateInput, valid({ stages: stages(31) }))).toEqual({ stages: "Maksimal 30 Tahap." });
      expect(
        fieldsOf(createPipelineTemplateInput, valid({ stages: [{ name: "Identifikasi", tasks: tasks(31) }] })),
      ).toEqual({ "stages.0.tasks": "Maksimal 30 Tugas per Tahap." });
    });

    it("refuses a name another active template has, ignoring case and spaces, with 409 template_name_taken", async () => {
      await createOk({ name: "Sekolah" });
      const response = await create(valid({ name: "  SEKOLAH " }));
      expect(response.status).toBe(409);
      expect(await errorOf(response)).toEqual({
        code: "template_name_taken",
        message: "Nama template sudah dipakai.",
        fields: { name: "Nama template sudah dipakai." },
      });
      expect((await sql`select 1 from pipeline_template`).length).toBe(1);
    });

    it("creates one template when two creates with the same name race, answering 409 to the other", async () => {
      const responses = await Promise.all([create(valid({ name: "Pasar" })), create(valid({ name: "pasar " }))]);
      expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
      const refused = responses.find((response) => response.status === 409)!;
      expect((await errorOf(refused)).code).toBe("template_name_taken");
      expect((await sql`select 1 from pipeline_template`).length).toBe(1);
    });

    it("drops unknown keys and keeps no account-holder column", async () => {
      const template = await createOk({ nik: "3201234567890001", stages: [{ name: "Identifikasi", balance: 5, tasks: [{ name: "A", nik: "x" }] }] });
      expect(Object.keys(template)).not.toContain("nik");
      expect(template.stages[0]).not.toHaveProperty("balance");
      const columns = await sql<{ table_name: string; column_name: string }[]>`
        select table_name, column_name from information_schema.columns
        where table_name in ('pipeline_template', 'template_stage', 'template_task') order by table_name, column_name`;
      expect(columns.map((row) => `${row.table_name}.${row.column_name}`)).toEqual([
        "pipeline_template.archived_at",
        "pipeline_template.created_at",
        "pipeline_template.id",
        "pipeline_template.name",
        "pipeline_template.name_key",
        "pipeline_template.updated_at",
        "pipeline_template.version",
        "template_stage.id",
        "template_stage.name",
        "template_stage.position",
        "template_stage.template_id",
        "template_task.id",
        "template_task.name",
        "template_task.position",
        "template_task.stage_id",
      ]);
    });

    it("needs an Idempotency-Key; a repeat with the same key answers 200 with the same template and creates nothing", async () => {
      const noKey = await listRoute.POST(request("/api/pipeline-templates", "POST", { body: valid() }));
      expect(noKey.status).toBe(400);
      expect((await errorOf(noKey)).code).toBe("idempotency_key");

      const key = randomUUID();
      const first = await create(valid(), key);
      const second = await create(valid(), key);
      expect(first.status).toBe(201);
      expect(second.status).toBe(200);
      expect(await second.json()).toEqual(await first.json());
      expect((await sql`select 1 from pipeline_template`).length).toBe(1);
      const [stored] = await sql`select scope from idempotency_key where key = ${key}`;
      expect(stored.scope).toBe(CREATE_SCOPE);
      expect(CREATE_SCOPE).toBe("pipeline-template.create");
    });

    it("GET :id returns the template with Stages and Tasks in order; 404 for unknown or malformed ids", async () => {
      const created = await createOk();
      const response = await get(created.id);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(await response.json()).toEqual(created);
      for (const id of [MISSING_ID, "bukan-uuid"]) {
        const missing = await get(id);
        expect(missing.status).toBe(404);
        expect((await errorOf(missing)).code).toBe("not_found");
      }
    });

    it("GET lists active templates first, then archived, each by name, with Stage and Pipeline counts", async () => {
      const zebra = await createOk({ name: "Zebra" });
      const pasar = await createOk({ name: "pasar", stages: [{ name: "Identifikasi" }] });
      const arsip = await createOk({ name: "Arsip" });
      const archived = (await (await archive(arsip.id, arsip.version)).json()) as Template;
      const items = await list();
      expect(items).toEqual([
        { id: pasar.id, name: "pasar", stageCount: 1, pipelineCount: 0, archived: false, version: 1, updatedAt: expect.any(String) },
        { id: zebra.id, name: "Zebra", stageCount: 2, pipelineCount: 0, archived: false, version: 1, updatedAt: expect.any(String) },
        { id: arsip.id, name: "Arsip", stageCount: 2, pipelineCount: 0, archived: true, version: archived.version, updatedAt: expect.any(String) },
      ]);
    });
  });

  describe("criterion 2: a fresh database has the default template Umum", () => {
    const scratchDb = `bftm_e3s1_${Date.now()}`;
    let admin: postgres.Sql;
    const scratchUrl = (() => {
      const url = new URL(TEST_URL);
      url.pathname = `/${scratchDb}`;
      return url.toString();
    })();

    const DEFAULT = [
      ["Identifikasi", ["Kumpulkan data Prospect", "Tentukan Kontak"]],
      ["Pendekatan", ["Hubungi Kontak", "Jadwalkan kunjungan pertama"]],
      ["Presentasi", ["Siapkan materi", "Presentasi ke pengambil keputusan", "Kirim proposal"]],
      ["Negosiasi", ["Bahas jumlah rekening", "Sepakati jadwal pembukaan"]],
      ["Pembukaan Rekening", ["Siapkan formulir", "Kumpulkan dokumen pendukung"]],
    ];

    async function runMigrate() {
      const { stdout } = await run("npm", ["run", "--silent", "db:migrate"], {
        cwd: root,
        env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: "test", DATABASE_URL: scratchUrl },
      });
      return stdout;
    }

    async function templatesIn(url: string) {
      const db = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
      try {
        const templates = await db<{ id: string; name: string; version: number; archived_at: Date | null }[]>`
          select id, name, version, archived_at from pipeline_template order by name`;
        const stages = await db<{ template_id: string; stage: string; position: number; tasks: string[] }[]>`
          select s.template_id, s.name as stage, s.position,
                 coalesce(array_agg(t.name order by t.position) filter (where t.id is not null), '{}') as tasks
          from template_stage s left join template_task t on t.stage_id = s.id
          group by s.id order by s.position`;
        return templates.map((template) => ({
          name: template.name,
          version: template.version,
          archived: template.archived_at !== null,
          stages: stages.filter((stage) => stage.template_id === template.id).map((stage) => [stage.stage, stage.tasks]),
          positions: stages.filter((stage) => stage.template_id === template.id).map((stage) => stage.position),
        }));
      } finally {
        await db.end();
      }
    }

    beforeAll(async () => {
      admin = postgres(TEST_URL, { max: 1, prepare: false, onnotice: () => {} });
      await admin.unsafe(`create database "${scratchDb}"`);
    });

    afterAll(async () => {
      await admin.unsafe(`drop database if exists "${scratchDb}" with (force)`);
      await admin.end();
    });

    it("db:migrate on a fresh database creates exactly one template, Umum, with the five Stages in order and their Tasks", async () => {
      expect(await runMigrate()).toContain("Migrations applied.");
      expect(await templatesIn(scratchUrl)).toEqual([
        { name: "Umum", version: 1, archived: false, stages: DEFAULT, positions: [1, 2, 3, 4, 5] },
      ]);
    });

    it("running db:migrate again does not add a second default", async () => {
      expect(await runMigrate()).toContain("Migrations applied.");
      expect(await templatesIn(scratchUrl)).toHaveLength(1);
    });

    it("the seed itself inserts nothing when a template already exists", async () => {
      const file = readdirSync(join(root, "drizzle")).find((name) => /_pipeline_template\.sql$/.test(name));
      expect(file).toBeDefined();
      const migration = readFileSync(join(root, "drizzle", file!), "utf8");
      const seed = /-- seed:default-template:start([\s\S]*?)-- seed:default-template:end/.exec(migration)?.[1];
      expect(seed).toBeDefined();
      const db = postgres(scratchUrl, { max: 1, prepare: false, onnotice: () => {} });
      try {
        await db.unsafe(seed!.replaceAll("--> statement-breakpoint", ""));
      } finally {
        await db.end();
      }
      expect(await templatesIn(scratchUrl)).toHaveLength(1);
    });
  });

  describe("criterion 3: Stages and Tasks can be added, renamed, reordered and removed (PUT replaces the whole template)", () => {
    it("adds, renames, reorders and removes Stages and Tasks, answering 200 with version + 1", async () => {
      const created = await createOk({
        stages: [
          { name: "Identifikasi", tasks: [{ name: "Kumpulkan data" }, { name: "Tentukan Kontak" }] },
          { name: "Pendekatan", tasks: [{ name: "Hubungi Kontak" }] },
          { name: "Presentasi", tasks: [{ name: "Siapkan materi" }, { name: "Kirim proposal" }] },
        ],
      });
      const response = await put(created.id, {
        name: "Sekolah Dasar",
        version: created.version,
        stages: [
          // Presentasi moves first, its Tasks reordered and one added.
          { name: "Presentasi", tasks: [{ name: "Kirim proposal" }, { name: "Siapkan materi" }, { name: "Tindak lanjut" }] },
          // Identifikasi renamed; one Task renamed, one removed.
          { name: "Identifikasi Sekolah", tasks: [{ name: "Kumpulkan data Prospect" }] },
          // Pendekatan removed; a new Stage added.
          { name: "Negosiasi" },
        ],
      });
      expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
      const updated = (await response.json()) as Template;
      expect(updated.name).toBe("Sekolah Dasar");
      expect(updated.version).toBe(created.version + 1);
      expect(outline(updated)).toEqual([
        ["Presentasi", ["Kirim proposal", "Siapkan materi", "Tindak lanjut"]],
        ["Identifikasi Sekolah", ["Kumpulkan data Prospect"]],
        ["Negosiasi", []],
      ]);
      expect(updated.stages.map((stage) => stage.position)).toEqual([1, 2, 3]);
      expect(updated.stages[0].tasks.map((task) => task.position)).toEqual([1, 2, 3]);
      expect(await (await get(created.id)).json()).toEqual(updated);
      // Removed Stages and Tasks are gone from the database, not orphaned.
      const [{ stages }] = await sql`select count(*)::int as stages from template_stage`;
      const [{ tasks }] = await sql`select count(*)::int as tasks from template_task`;
      expect({ stages, tasks }).toEqual({ stages: 3, tasks: 4 });
    });

    it("keeps the name when only Stages change, and allows saving a name that only differs in case from its own", async () => {
      const created = await createOk();
      const response = await put(created.id, { name: "SEKOLAH", version: 1, stages: [{ name: "Identifikasi" }] });
      expect(response.status).toBe(200);
      expect(((await response.json()) as Template).name).toBe("SEKOLAH");
    });

    it("validates the body like create: no Stages, field paths, version", async () => {
      const created = await createOk();
      const empty = await put(created.id, { name: "Sekolah", version: 1, stages: [] });
      expect(empty.status).toBe(400);
      expect((await errorOf(empty)).fields).toEqual({ stages: "Tambahkan minimal satu Stage." });
      const noVersion = await put(created.id, { name: "Sekolah", stages: STAGES });
      expect((await errorOf(noVersion)).fields).toEqual({ version: "Wajib diisi." });
      expect(outline((await (await get(created.id)).json()) as Template)).toEqual(outline({ stages: STAGES.map((s) => ({ name: s.name, tasks: s.tasks ?? [] })) }));
    });

    it("answers 409 version_conflict for a stale version and changes nothing", async () => {
      const created = await createOk();
      expect((await put(created.id, { name: "Baru", version: 1, stages: [{ name: "A" }] })).status).toBe(200);
      const stale = await put(created.id, { name: "Lama", version: 1, stages: [{ name: "B" }] });
      expect(stale.status).toBe(409);
      expect(await errorOf(stale)).toEqual({
        code: "version_conflict",
        message: "Data ini sudah diubah. Muat ulang untuk melihat versi terbaru.",
      });
      const current = (await (await get(created.id)).json()) as Template;
      expect({ name: current.name, version: current.version, outline: outline(current) }).toEqual({
        name: "Baru",
        version: 2,
        outline: [["A", []]],
      });
    });

    it("answers 404 for an unknown id", async () => {
      expect((await put(MISSING_ID, { name: "A", version: 1, stages: [{ name: "A" }] })).status).toBe(404);
    });

    it("refuses renaming to another active template's name with 409 template_name_taken", async () => {
      await createOk({ name: "Pasar" });
      const sekolah = await createOk({ name: "Sekolah" });
      const response = await put(sekolah.id, { name: "pasar", version: 1, stages: STAGES });
      expect(response.status).toBe(409);
      expect((await errorOf(response)).code).toBe("template_name_taken");
    });

    it("refuses editing an archived template with 422 template_archived", async () => {
      await createOk({ name: "Umum" });
      const created = await createOk();
      const archived = (await (await archive(created.id, 1)).json()) as Template;
      const response = await put(created.id, { name: "Baru", version: archived.version, stages: STAGES });
      expect(response.status).toBe(422);
      expect(await errorOf(response)).toEqual({ code: "template_archived", message: PIPELINE_TEMPLATE_ARCHIVED_MESSAGE });
      expect(PIPELINE_TEMPLATE_ARCHIVED_MESSAGE).toBe("Template ini diarsipkan. Pulihkan dulu untuk mengubahnya.");
    });
  });

  describe("criterion 4: a template in use can be archived but not deleted; an unused one can be deleted (EC21)", () => {
    it("deletes an unused template with 204, removing its Stages and Tasks", async () => {
      await createOk({ name: "Umum" });
      const created = await createOk();
      const response = await del(created.id);
      expect(response.status).toBe(204);
      expect(await response.text()).toBe("");
      expect((await get(created.id)).status).toBe(404);
      const [{ stages }] = await sql`select count(*)::int as stages from template_stage where template_id = ${created.id}`;
      const [{ tasks }] = await sql`select count(*)::int as tasks from template_task`;
      // Only the other template's three Tasks are left.
      expect({ stages, tasks }).toEqual({ stages: 0, tasks: 3 });
      expect((await del(created.id)).status).toBe(404);
      expect((await del("bukan-uuid")).status).toBe(404);
    });

    it("deletes an archived unused template", async () => {
      await createOk({ name: "Umum" });
      const created = await createOk();
      await archive(created.id, 1);
      expect((await del(created.id)).status).toBe(204);
    });

    it("counts 0 Pipelines for a template no Pipeline uses (the in-use path is tested in E3-S3)", async () => {
      const created = await createOk();
      expect(await countPipelinesUsingTemplate(getDb(), created.id)).toBe(0);
    });

    it("archives a template, idempotently: a repeat answers 200 unchanged whatever the version", async () => {
      await createOk({ name: "Umum" });
      const created = await createOk();
      const first = await archive(created.id, 1);
      expect(first.status).toBe(200);
      const archived = (await first.json()) as Template;
      expect(archived).toMatchObject({ archived: true, archivedAt: expect.any(String), version: 2 });
      expect(archived.stages).toEqual(created.stages);
      const again = await archive(created.id, 1);
      expect(again.status).toBe(200);
      expect(await again.json()).toEqual(archived);
    });

    it("answers 409 for a stale version when archiving, 404 for an unknown id", async () => {
      await createOk({ name: "Umum" });
      const created = await createOk();
      await put(created.id, { name: "Baru", version: 1, stages: STAGES });
      expect((await archive(created.id, 1)).status).toBe(409);
      expect((await archive(MISSING_ID, 1)).status).toBe(404);
    });

    it("refuses archiving or deleting the last active template with 422 last_template", async () => {
      const only = await createOk({ name: "Umum" });
      const archiving = await archive(only.id, 1);
      expect(archiving.status).toBe(422);
      expect(await errorOf(archiving)).toEqual({ code: "last_template", message: "Harus ada minimal satu template aktif." });
      const deleting = await del(only.id);
      expect(deleting.status).toBe(422);
      expect((await errorOf(deleting)).code).toBe("last_template");
      expect((await get(only.id)).status).toBe(200);

      // With another active template, it can go.
      const other = await createOk({ name: "Pasar" });
      expect((await archive(only.id, 1)).status).toBe(200);
      // Now Pasar is the last active one.
      expect((await del(other.id)).status).toBe(422);
    });
  });

  describe("criterion 5: an archived template cannot start a Pipeline and can be restored (EC21)", () => {
    it("restores an archived template, idempotently", async () => {
      await createOk({ name: "Umum" });
      const created = await createOk();
      const archived = (await (await archive(created.id, 1)).json()) as Template;
      const restored = await restore(created.id, archived.version);
      expect(restored.status).toBe(200);
      const body = (await restored.json()) as Template;
      expect(body).toMatchObject({ archived: false, archivedAt: null, version: archived.version + 1 });
      const again = await restore(created.id, 1);
      expect(again.status).toBe(200);
      expect(await again.json()).toEqual(body);
      expect((await restore(MISSING_ID, 1)).status).toBe(404);
    });

    it("refuses restoring when an active template has taken the name meanwhile", async () => {
      await createOk({ name: "Umum" });
      const created = await createOk({ name: "Sekolah" });
      const archived = (await (await archive(created.id, 1)).json()) as Template;
      await createOk({ name: "sekolah" });
      const response = await restore(created.id, archived.version);
      expect(response.status).toBe(409);
      expect((await errorOf(response)).code).toBe("template_name_taken");
    });

    it("assertTemplateCanStartPipeline refuses an archived template and an unknown one, and passes an active one", async () => {
      await createOk({ name: "Umum" });
      const created = await createOk();
      const db = getDb();
      await expect(db.transaction((tx) => assertTemplateCanStartPipeline(tx, created.id))).resolves.toBeUndefined();
      await archive(created.id, 1);
      await expect(db.transaction((tx) => assertTemplateCanStartPipeline(tx, created.id))).rejects.toMatchObject({
        status: 422,
        code: "template_archived_cannot_start",
        message: "Template ini diarsipkan dan tidak bisa dipakai untuk Pipeline baru.",
      });
      expect(TEMPLATE_CANNOT_START_MESSAGE).toBe("Template ini diarsipkan dan tidak bisa dipakai untuk Pipeline baru.");
      for (const id of [MISSING_ID, "bukan-uuid"]) {
        await expect(db.transaction((tx) => assertTemplateCanStartPipeline(tx, id))).rejects.toMatchObject({
          status: 422,
          code: "template_not_found",
          message: "Template tidak ditemukan.",
        });
      }
    });

    it("getTemplateForSnapshot returns the ordered Stages and Tasks to copy", async () => {
      const created = await createOk();
      const snapshot = await getDb().transaction((tx) => getTemplateForSnapshot(tx, created.id));
      expect(snapshot).toEqual({
        id: created.id,
        name: "Sekolah",
        stages: [
          { position: 1, name: "Identifikasi", tasks: [{ position: 1, name: "Kumpulkan data Prospect" }] },
          {
            position: 2,
            name: "Presentasi",
            tasks: [
              { position: 1, name: "Siapkan materi" },
              { position: 2, name: "Kirim proposal" },
            ],
          },
        ],
      });
      await expect(getDb().transaction((tx) => getTemplateForSnapshot(tx, MISSING_ID))).rejects.toMatchObject({ status: 404 });
    });
  });

  describe("authorization and Origin", () => {
    it("answers 401 for every handler without a session", async () => {
      const id = MISSING_ID;
      const responses = [
        await listRoute.GET(request("/api/pipeline-templates", "GET", { auth: false })),
        await listRoute.POST(request("/api/pipeline-templates", "POST", { auth: false, body: valid(), headers: { "Idempotency-Key": randomUUID() } })),
        await itemRoute.GET(request(`/api/pipeline-templates/${id}`, "GET", { auth: false }), ctx(id)),
        await itemRoute.PUT(request(`/api/pipeline-templates/${id}`, "PUT", { auth: false, body: { ...valid(), version: 1 } }), ctx(id)),
        await itemRoute.DELETE(request(`/api/pipeline-templates/${id}`, "DELETE", { auth: false }), ctx(id)),
        await archiveRoute.POST(request(`/api/pipeline-templates/${id}/archive`, "POST", { auth: false, body: { version: 1 } }), ctx(id)),
        await restoreRoute.POST(request(`/api/pipeline-templates/${id}/restore`, "POST", { auth: false, body: { version: 1 } }), ctx(id)),
      ];
      for (const response of responses) {
        expect(response.status).toBe(401);
        expect((await errorOf(response)).code).toBe("unauthorized");
      }
    });

    it("answers 403 forbidden_origin for every mutation from another origin, and changes nothing", async () => {
      await createOk({ name: "Umum" });
      const created = await createOk();
      const evil = { origin: "https://evil.example" };
      const responses = [
        await create(valid({ name: "Lain" }), randomUUID(), evil),
        await put(created.id, { name: "Lain", version: 1, stages: STAGES }, evil),
        await del(created.id, evil),
        await archive(created.id, 1, evil),
        await restore(created.id, 1, evil),
      ];
      for (const response of responses) {
        expect(response.status).toBe(403);
        expect((await errorOf(response)).code).toBe("forbidden_origin");
      }
      expect(await (await get(created.id)).json()).toEqual(created);
      expect((await sql`select 1 from pipeline_template`).length).toBe(2);
    });
  });
});
