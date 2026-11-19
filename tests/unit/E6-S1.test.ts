// E6-S1: the map data. Every located, non-archived Prospect with its latest Pipeline's Stage and
// Outcome, filtered by Funding Officer and Stage on the server, lean enough for 2,000 markers.
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "@/server/auth/password";
import { SESSION_COOKIE, hashSessionToken } from "@/server/auth/session";
import { listMapProspects, mapProspectQuery } from "@/server/prospects";
import * as mapRoute from "@/app/api/map/prospects/route";
import { migrateTestDatabase, testDatabaseUrl, truncateAllTables } from "./support/test-db";

const TEST_URL = testDatabaseUrl();
const ORIGIN = "http://localhost:3000";
let sql: postgres.Sql;
let token: string;
let rina: Officer;
let agus: Officer;
let templateId: string;

type Officer = { id: string; name: string };
type ErrorBody = { error: { code: string; message: string; fields?: Record<string, string> } };
type MapStage = { name: string; position: number; count: number };
type MapRow = {
  id: string;
  name: string;
  category: string | null;
  lat: number;
  lng: number;
  fundingOfficer: number;
  stage: number | null;
  outcome: "won" | "lost" | "on_hold" | null;
};
type MapBody = { items: MapRow[]; fundingOfficers: { id: string; name: string; active: boolean }[]; stages: MapStage[] };

/** The rows with their indexes resolved, as the map reads them. */
function resolved(body: MapBody) {
  return body.items.map(({ fundingOfficer, stage, ...row }) => ({
    ...row,
    fundingOfficer: body.fundingOfficers[fundingOfficer],
    stage: stage === null ? null : body.stages[stage],
  }));
}

const STAGES = ["Identifikasi", "Pendekatan", "Presentasi", "Negosiasi", "Pembukaan Rekening"];

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

async function insertTemplate(name: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into pipeline_template (name, name_key) values (${name}, ${name.toLowerCase()}) returning id`;
  return row.id;
}

async function insertProspect(
  name: string,
  { officer = rina, location = { lat: -6.4817, lng: 106.854 }, archived = false, category = "sekolah" }: {
    officer?: Officer;
    location?: { lat: number; lng: number } | null;
    archived?: boolean;
    category?: string | null;
  } = {},
): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into prospect (name, name_key, category, lat, lng, funding_officer_id, archived_at)
    values (${name}, ${name.toLowerCase()}, ${category}, ${location?.lat ?? null}, ${location?.lng ?? null}, ${officer.id},
            ${archived ? sql`now()` : null})
    returning id`;
  return row.id;
}

/** A Pipeline with five Stages, at `stage`, with the given Outcome, started `daysAgo` days ago. */
async function insertPipeline(
  prospectId: string,
  { stage = 1, outcome = null, daysAgo = 0, template = templateId }: {
    stage?: number;
    outcome?: "won" | "lost" | "on_hold" | null;
    daysAgo?: number;
    template?: string;
  } = {},
): Promise<void> {
  const won = outcome === "won";
  const [row] = await sql<{ id: string }[]>`
    insert into pipeline (prospect_id, template_id, funding_officer_id, current_stage_position, outcome, accounts_opened, won_on,
                          lost_reason, closed_at, started_at)
    select ${prospectId}, ${template}, funding_officer_id, ${stage}, ${outcome}, ${won ? 10 : null}, ${won ? "2026-11-01" : null},
           ${outcome === "lost" ? "Tidak berminat" : null}, ${won || outcome === "lost" ? sql`now()` : null},
           now() - make_interval(days => ${daysAgo})
    from prospect where id = ${prospectId}
    returning id`;
  for (const [index, name] of STAGES.entries()) {
    await sql`insert into pipeline_stage (pipeline_id, position, name) values (${row.id}, ${index + 1}, ${name})`;
  }
}

function get(query = "", auth = true) {
  return mapRoute.GET(
    new Request(`${ORIGIN}/api/map/prospects${query}`, {
      headers: { host: "localhost:3000", ...(auth ? { cookie: `${SESSION_COOKIE}=${token}` } : {}) },
    }),
  );
}

async function getOk(query = ""): Promise<MapBody> {
  const response = await get(query);
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
  return (await response.json()) as MapBody;
}

const names = (body: MapBody) => body.items.map((row) => row.name);

describe("E6-S1 map data", () => {
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
    templateId = await insertTemplate("Umum");
  });

  afterAll(async () => {
    await sql.end();
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
  });

  it("needs an Admin session (401) and is not cached", async () => {
    expect((await get("", false)).status).toBe(401);
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  describe("criterion 1: every non-archived located Prospect with ID, name, Category, Funding Officer, location, and its latest Pipeline's Stage (with position) and Outcome (EC34)", () => {
    it("returns the compact row and the Funding Officers it refers to, sorted by name", async () => {
      const sdn = await insertProspect("SDN 3 Cibinong", { location: { lat: -6.4817, lng: 106.854 } });
      await insertPipeline(sdn, { stage: 3 });
      const pasar = await insertProspect("Pasar Anyar", { officer: agus, category: null, location: { lat: -6.59, lng: 106.79 } });

      const body = await getOk();
      expect(resolved(body)).toEqual([
        {
          id: pasar,
          name: "Pasar Anyar",
          category: null,
          lat: -6.59,
          lng: 106.79,
          fundingOfficer: { id: agus.id, name: "Agus Setiawan", active: true },
          stage: null,
          outcome: null,
        },
        {
          id: sdn,
          name: "SDN 3 Cibinong",
          category: "sekolah",
          lat: -6.4817,
          lng: 106.854,
          fundingOfficer: { id: rina.id, name: "Rina Kartika", active: true },
          stage: { name: "Presentasi", position: 3, count: 5 },
          outcome: null,
        },
      ]);
      // Each Funding Officer and Stage is sent once, however many markers share it.
      expect(body.fundingOfficers).toHaveLength(2);
      expect(body.stages).toHaveLength(1);
    });

    it("rounds coordinates to 6 decimals (about 0.1 m)", async () => {
      await insertProspect("SDN 1", { location: { lat: -6.123456789012345, lng: 106.987654321098765 } });
      expect((await getOk()).items[0]).toMatchObject({ lat: -6.123457, lng: 106.987654 });
    });

    it("shares one Stage entry between markers at the same Stage, and keeps Stages of different Stage counts apart", async () => {
      for (const name of ["A", "B"]) await insertPipeline(await insertProspect(name), { stage: 2 });
      const c = await insertProspect("C");
      await insertPipeline(c, { stage: 2 });
      await sql`delete from pipeline_stage where position = 5 and pipeline_id in (select id from pipeline where prospect_id = ${c})`;
      const body = await getOk();
      expect(body.items.map((row) => row.stage)).toEqual([0, 0, 1]);
      expect(body.stages).toEqual([
        { name: "Pendekatan", position: 2, count: 5 },
        { name: "Pendekatan", position: 2, count: 4 },
      ]);
    });

    it("leaves out Prospects without a location (EC34) and archived ones", async () => {
      await insertProspect("Ada lokasi");
      await insertProspect("Belum ada lokasi", { location: null });
      await insertProspect("Diarsipkan", { archived: true });
      expect(names(await getOk())).toEqual(["Ada lokasi"]);
    });

    it("answers an empty list when no Prospect has a location (EC5 is shown by E6-S2)", async () => {
      await insertProspect("Belum ada lokasi", { location: null });
      expect(await getOk()).toEqual({ items: [], fundingOfficers: [], stages: [] });
    });

    it("shows the latest Pipeline: Won and Lost with their Stage, On Hold, and an open one over a newer closed one", async () => {
      const won = await insertProspect("A Won");
      await insertPipeline(won, { stage: 1, outcome: "lost", daysAgo: 30 });
      await insertPipeline(won, { stage: 5, outcome: "won", daysAgo: 2 });
      const lost = await insertProspect("B Lost");
      await insertPipeline(lost, { stage: 2, outcome: "lost" });
      const onHold = await insertProspect("C On Hold");
      await insertPipeline(onHold, { stage: 4, outcome: "on_hold" });
      const reopened = await insertProspect("D Reopened");
      await insertPipeline(reopened, { stage: 2, outcome: null, daysAgo: 30 }); // reopened older Pipeline
      await insertPipeline(reopened, { stage: 5, outcome: "lost", daysAgo: 1 });

      const latest = Object.fromEntries(resolved(await getOk()).map((row) => [row.name, [row.stage?.name, row.stage?.position, row.outcome]]));
      expect(latest).toEqual({
        "A Won": ["Pembukaan Rekening", 5, "won"],
        "B Lost": ["Pendekatan", 2, "lost"],
        "C On Hold": ["Negosiasi", 4, "on_hold"],
        "D Reopened": ["Pendekatan", 2, null],
      });
    });

    it("never carries contact or account data (ADR 0001)", async () => {
      await sql`
        insert into prospect (name, name_key, lat, lng, funding_officer_id, contact_name, contact_phone, potential_accounts, note, address)
        values ('SDN 1', 'sdn 1', -6.5, 106.8, ${rina.id}, 'Ibu Sri', '+6281234567890', 350, 'catatan', 'Jl. Raya')`;
      const [row] = (await getOk()).items;
      expect(Object.keys(row).sort()).toEqual(["category", "fundingOfficer", "id", "lat", "lng", "name", "outcome", "stage"]);
    });
  });

  describe("criterion 2: filters by Funding Officer and Stage on the server", () => {
    it("filters by Funding Officer, by Stage (open or On Hold Pipeline of that template at that position), and both", async () => {
      const other = await insertTemplate("Pasar");
      const a = await insertProspect("A");
      await insertPipeline(a, { stage: 3 });
      const b = await insertProspect("B", { officer: agus });
      await insertPipeline(b, { stage: 3, outcome: "on_hold" });
      const c = await insertProspect("C", { officer: agus });
      await insertPipeline(c, { stage: 3, outcome: "won" });
      const d = await insertProspect("D");
      await insertPipeline(d, { stage: 3, template: other });
      await insertProspect("E", { officer: agus });

      expect(names(await getOk(`?fundingOfficerId=${agus.id}`))).toEqual(["B", "C", "E"]);
      expect(names(await getOk(`?templateId=${templateId}&stagePosition=3`))).toEqual(["A", "B"]);
      expect(names(await getOk(`?fundingOfficerId=${agus.id}&templateId=${templateId}&stagePosition=3`))).toEqual(["B"]);
      expect(names(await getOk(`?fundingOfficerId=&templateId=&stagePosition=`))).toEqual(["A", "B", "C", "D", "E"]);
      const filtered = await getOk(`?fundingOfficerId=${agus.id}`);
      expect(filtered.fundingOfficers).toEqual([{ id: agus.id, name: "Agus Setiawan", active: true }]);
    });

    it("rejects invalid filters with 400 validation", async () => {
      for (const [query, field] of [
        ["?fundingOfficerId=bukan-uuid", "fundingOfficerId"],
        [`?templateId=${randomUUID()}`, "stagePosition"],
        ["?stagePosition=2", "templateId"],
        [`?templateId=${randomUUID()}&stagePosition=0`, "stagePosition"],
        [`?templateId=${randomUUID()}&stagePosition=31`, "stagePosition"],
      ]) {
        const response = await get(query);
        expect(response.status, query).toBe(400);
        const error = ((await response.json()) as ErrorBody).error;
        expect(error.code, query).toBe("validation");
        expect(Object.keys(error.fields ?? {}), query).toEqual([field]);
      }
    });
  });

  describe("criterion 3: with 2,000 located Prospects, the response is under 500 KB and answers in under 500 ms (EC6)", () => {
    it("stays under 500 KB and 500 ms (median of 3 runs, each query shape)", async () => {
      // Realistic names and full-precision coordinates around Jabodetabek; one Pipeline each, in every state.
      await sql`
        insert into prospect (name, name_key, category, lat, lng, funding_officer_id)
        select n, lower(n),
          (array['sekolah','pasar','perusahaan','instansi','komunitas','lainnya'])[1 + i % 6]::prospect_category,
          -6.6 + random() * 0.5, 106.6 + random() * 0.5,
          (array[${rina.id}, ${agus.id}]::uuid[])[1 + i % 2]
        from (select i, (array['SDN ','Pasar ','PT Sinar Logistik ','Kantor Kecamatan ','Paguyuban Pedagang '])[1 + i % 5]
                || 'Cibinong ' || i as n
              from generate_series(1, 2000) as i) as s`;
      await sql`
        insert into pipeline (prospect_id, template_id, funding_officer_id, current_stage_position, outcome, accounts_opened, won_on, lost_reason, closed_at)
        select p.id, ${templateId}, p.funding_officer_id, 1 + r % 5,
          o, case when o = 'won' then 10 end, case when o = 'won' then current_date end,
          case when o = 'lost' then 'x' end, case when o in ('won', 'lost') then now() end
        from (select id, funding_officer_id, row_number() over (order by id) as r from prospect) as p,
          lateral (select (array[null, null, 'on_hold', 'won', 'lost'])[1 + p.r % 5]::pipeline_outcome as o) as x`;
      await sql`
        insert into pipeline_stage (pipeline_id, position, name)
        select p.id, s.position, s.name from pipeline p,
          (values (1, 'Identifikasi'), (2, 'Pendekatan'), (3, 'Presentasi'), (4, 'Negosiasi'), (5, 'Pembukaan Rekening')) as s(position, name)`;
      await sql`analyze prospect; analyze pipeline; analyze pipeline_stage`.simple();

      const all = await get();
      const bytes = Buffer.byteLength(await all.text());
      console.info(`[E6-S1] map response with 2,000 Prospects: ${Math.round(bytes / 1024)} KB`);
      expect(bytes).toBeLessThan(500 * 1024);

      const shapes = [{}, { fundingOfficerId: agus.id }, { templateId, stagePosition: "3" }];
      const timings: Record<string, number> = {};
      for (const shape of shapes) {
        const query = mapProspectQuery.parse(shape);
        const runs: number[] = [];
        for (let run = 0; run < 3; run++) {
          const begin = performance.now();
          await listMapProspects(query);
          runs.push(performance.now() - begin);
        }
        const median = runs.sort((x, y) => x - y)[1];
        timings[JSON.stringify(shape)] = Math.round(median * 10) / 10;
        expect(median, JSON.stringify(shape)).toBeLessThan(500);
      }
      console.info("[E6-S1] map median ms with 2,000 Prospects:", timings);
      expect((await listMapProspects(mapProspectQuery.parse({}))).items).toHaveLength(2000);
    });
  });
});
