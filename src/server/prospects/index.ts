// Prospects (E2-S1): the one list of institutions and venues the team works. Never deleted (EC22),
// only archived and restored. Route Handlers live in src/app/api/prospects/ (ADR 0003).
// ADR 0001: a Prospect is never an account holder; the only person stored is its Contact Person.
import "server-only";
import { type SQL, and, asc, count, eq, exists, gt, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import type { z } from "zod";
import { activity, fundingOfficer, pipeline, pipelineStage, prospect } from "@/db/schema";
import { type Db, type Tx, getDb } from "@/server/db";
import { assertAssignableFundingOfficer } from "@/server/funding-officers";
import { ApiError, invalidState, notFound, updateWithVersion } from "@/server/http";
import {
  type ProspectCategory,
  type createProspectInput,
  type mapProspectQuery,
  type prospectListQuery,
  type prospectStatusInput,
  type updateProspectInput,
  prospectNameKey,
} from "@/server/validation";

export {
  PROSPECT_CATEGORIES,
  PROSPECT_NAME_MAX,
  createProspectInput,
  mapProspectQuery,
  prospectListQuery,
  prospectNameKey,
  prospectStatusInput,
  updateProspectInput,
} from "@/server/validation";

export const PROSPECT_ARCHIVED_MESSAGE = "Prospect ini diarsipkan. Pulihkan dulu untuk mengubahnya.";
/** Archiving a Prospect with an open or On Hold Pipeline (E3-S3 criterion 8, EC19). */
export const PROSPECT_HAS_OPEN_PIPELINE_MESSAGE = "Tutup atau tunda Pipeline dulu.";
/** The idempotency scope of POST /api/prospects. */
export const CREATE_SCOPE = "prospect.create";
/** Rows per page of the list (E2-S1 criterion 4, EC6). */
export const LIST_PAGE_SIZE = 50;
/** At most this many matching Prospects are returned as duplicates. */
export const DUPLICATES_LIMIT = 20;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Options = { db?: Db | Tx };
type FundingOfficerRef = { id: string; name: string; active: boolean };

/** The full record: GET /:id, archive and restore, and `prospect` in create and update responses. */
export type ProspectRecord = {
  id: string;
  name: string;
  category: ProspectCategory | null;
  address: string | null;
  location: { lat: number; lng: number } | null;
  contact: { name: string | null; role: string | null; phone: string | null };
  potentialAccounts: number | null;
  fundingOfficer: FundingOfficerRef;
  note: string | null;
  archived: boolean;
  archivedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

/** The Stage of a Prospect's open or On Hold Pipeline on a list row (E3-S3 criterion 9). */
export type OpenPipelineStage = { stageName: string; stagePosition: number; stageCount: number };

/** One row of the list. `openPipeline` is null when the Prospect has no open or On Hold Pipeline. */
export type ProspectListItem = {
  id: string;
  name: string;
  category: ProspectCategory | null;
  fundingOfficer: FundingOfficerRef;
  hasLocation: boolean;
  potentialAccounts: number | null;
  archived: boolean;
  openPipeline: OpenPipelineStage | null;
};

export type ProspectPage = { items: ProspectListItem[]; page: number; pageSize: number; total: number };
export type Duplicate = { id: string; name: string };
export type SavedProspect = { prospect: ProspectRecord; duplicates: Duplicate[] };

const officerColumns = {
  id: fundingOfficer.id,
  name: fundingOfficer.name,
  active: fundingOfficer.active,
};

type Row = typeof prospect.$inferSelect;

function toRecord(row: Row, officer: FundingOfficerRef): ProspectRecord {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    address: row.address,
    location: row.lat !== null && row.lng !== null ? { lat: row.lat, lng: row.lng } : null,
    contact: { name: row.contactName, role: row.contactRole, phone: row.contactPhone },
    potentialAccounts: row.potentialAccounts,
    fundingOfficer: officer,
    note: row.note,
    archived: row.archivedAt !== null,
    archivedAt: row.archivedAt,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const openOrOnHold = or(isNull(pipeline.outcome), eq(pipeline.outcome, "on_hold"));

/**
 * The open or On Hold Pipeline's Stage name, position and Stage count, as one JSON value, or null
 * (E3-S3 criterion 9). A correlated subquery per row of the page (50 at most): the partial unique
 * index finds the Pipeline, and (pipeline_id, position) finds the Stage. prospects reads the Pipeline
 * tables directly rather than importing the pipelines module (docs/architecture.md).
 */
const openPipelineSql = sql<OpenPipelineStage | null>`(
  select json_build_object(
    'stageName', ${pipelineStage.name},
    'stagePosition', ${pipeline.currentStagePosition},
    'stageCount', (select count(*)::int from ${pipelineStage} as all_stages where all_stages.pipeline_id = ${pipeline.id})
  )
  from ${pipeline}
  join ${pipelineStage} on ${pipelineStage.pipelineId} = ${pipeline.id} and ${pipelineStage.position} = ${pipeline.currentStagePosition}
  where ${pipeline.prospectId} = ${prospect.id} and (${pipeline.outcome} is null or ${pipeline.outcome} = 'on_hold')
)`;

/**
 * The Funding Officer and Stage filters, shared by the list and the map (E6-S1). The Stage filter
 * (E3-S3 criterion 9): the open or On Hold Pipeline is from this template and at this Stage.
 */
function officerAndStageFilters(
  db: Db | Tx,
  query: { fundingOfficerId?: string; templateId?: string; stagePosition?: number },
): SQL[] {
  const conditions: SQL[] = [];
  if (query.fundingOfficerId) conditions.push(eq(prospect.fundingOfficerId, query.fundingOfficerId));
  if (query.templateId !== undefined && query.stagePosition !== undefined) {
    conditions.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(pipeline)
          .where(
            and(
              eq(pipeline.prospectId, prospect.id),
              openOrOnHold,
              eq(pipeline.templateId, query.templateId),
              eq(pipeline.currentStagePosition, query.stagePosition),
            ),
          ),
      ),
    );
  }
  return conditions;
}

/** Escapes LIKE's wildcards so the search matches `%`, `_` and `\` literally. */
function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/**
 * A page of Prospects, sorted by name ignoring case and repeated spaces (name_key), then id.
 * `q` matches anywhere in the name, ignoring case and repeated spaces. Archived Prospects are left
 * out unless `archived` is set, which includes them alongside the others.
 */
export async function listProspects(
  query: z.output<typeof prospectListQuery>,
  { db = getDb() }: Options = {},
): Promise<ProspectPage> {
  const conditions: SQL[] = [];
  if (!query.archived) conditions.push(isNull(prospect.archivedAt));
  const q = query.q ? prospectNameKey(query.q) : "";
  if (q) conditions.push(sql`${prospect.nameKey} like ${likePattern(q)} escape '\\'`);
  if (query.category) conditions.push(eq(prospect.category, query.category));
  if (query.noLocation) conditions.push(isNull(prospect.lat));
  conditions.push(...officerAndStageFilters(db, query));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: prospect.id,
        name: prospect.name,
        category: prospect.category,
        hasLocation: isNotNull(prospect.lat).mapWith(Boolean),
        potentialAccounts: prospect.potentialAccounts,
        archived: isNotNull(prospect.archivedAt).mapWith(Boolean),
        fundingOfficer: officerColumns,
        openPipeline: openPipelineSql,
      })
      .from(prospect)
      .innerJoin(fundingOfficer, eq(fundingOfficer.id, prospect.fundingOfficerId))
      .where(where)
      .orderBy(asc(prospect.nameKey), asc(prospect.id))
      .limit(LIST_PAGE_SIZE)
      .offset((query.page - 1) * LIST_PAGE_SIZE),
    db.select({ total: count() }).from(prospect).where(where),
  ]);

  return {
    items: rows,
    page: query.page,
    pageSize: LIST_PAGE_SIZE,
    total,
  };
}

/** One Prospect, archived or not. Throws 404 when the id is unknown or not a UUID. */
export async function getProspect(id: string, { db = getDb() }: Options = {}): Promise<ProspectRecord> {
  if (!UUID.test(id)) throw notFound();
  const [row] = await db
    .select({ prospect, fundingOfficer: officerColumns })
    .from(prospect)
    .innerJoin(fundingOfficer, eq(fundingOfficer.id, prospect.fundingOfficerId))
    .where(eq(prospect.id, id));
  if (!row) throw notFound();
  return toRecord(row.prospect, row.fundingOfficer);
}

/**
 * Other non-archived Prospects whose name matches this one's, ignoring case and repeated spaces
 * (EC14), sorted by name. A match never blocks a save; it is reported so the Admin can check.
 */
export async function findDuplicates(id: string, { db = getDb() }: Options = {}): Promise<Duplicate[]> {
  const self = db.select({ nameKey: prospect.nameKey }).from(prospect).where(eq(prospect.id, id));
  return db
    .select({ id: prospect.id, name: prospect.name })
    .from(prospect)
    .where(and(sql`${prospect.nameKey} = (${self})`, ne(prospect.id, id), isNull(prospect.archivedAt)))
    .orderBy(asc(prospect.nameKey), asc(prospect.id))
    .limit(DUPLICATES_LIMIT);
}

/** The record and its duplicates, as create answers. */
export async function savedProspect(id: string, { db = getDb() }: Options = {}): Promise<SavedProspect> {
  return { prospect: await getProspect(id, { db }), duplicates: await findDuplicates(id, { db }) };
}

/**
 * Inserts a Prospect and returns its id. Run inside withIdempotency's transaction: the Funding
 * Officer is checked (and locked) in it, so 422 rolls back the key too.
 */
export async function createProspect(input: z.output<typeof createProspectInput>, { db }: { db: Tx }): Promise<string> {
  await assertAssignableFundingOfficer(db, input.fundingOfficerId);
  const [row] = await db
    .insert(prospect)
    .values({
      name: input.name,
      nameKey: prospectNameKey(input.name),
      category: input.category,
      address: input.address,
      lat: input.location?.lat ?? null,
      lng: input.location?.lng ?? null,
      contactName: input.contact.name,
      contactRole: input.contact.role,
      contactPhone: input.contact.phone,
      potentialAccounts: input.potentialAccounts,
      fundingOfficerId: input.fundingOfficerId,
      note: input.note,
    })
    .returning({ id: prospect.id });
  return row.id;
}

/** Locks the Prospect's row for this transaction. 404 when the id is unknown or not a UUID. */
async function lockProspect(tx: Tx, id: string): Promise<Row> {
  if (!UUID.test(id)) throw notFound();
  const [row] = await tx.select().from(prospect).where(eq(prospect.id, id)).for("update");
  if (!row) throw notFound();
  return row;
}

/**
 * Changes any subset of the fields. 404 for an unknown id, 422 prospect_archived for an archived
 * Prospect, 422 from the Funding Officer rule only when the Funding Officer changes, 409 for a
 * stale version. Reassigning the Funding Officer changes only the Prospect (EC26).
 * Duplicates are listed only when the name changed.
 */
export async function updateProspect(
  id: string,
  input: z.output<typeof updateProspectInput>,
  { db = getDb() }: { db?: Db } = {},
): Promise<SavedProspect> {
  return db.transaction(async (tx) => {
    const current = await lockProspect(tx, id);
    if (current.archivedAt !== null) throw new ApiError(422, "prospect_archived", PROSPECT_ARCHIVED_MESSAGE);
    if (input.fundingOfficerId !== undefined && input.fundingOfficerId !== current.fundingOfficerId) {
      await assertAssignableFundingOfficer(tx, input.fundingOfficerId);
    }

    const set: Partial<Row> = {};
    if (input.name !== undefined) {
      set.name = input.name;
      set.nameKey = prospectNameKey(input.name);
    }
    if (input.category !== undefined) set.category = input.category;
    if (input.fundingOfficerId !== undefined) set.fundingOfficerId = input.fundingOfficerId;
    if (input.address !== undefined) set.address = input.address;
    if (input.location !== undefined) {
      set.lat = input.location?.lat ?? null;
      set.lng = input.location?.lng ?? null;
    }
    if (input.contact !== undefined) {
      set.contactName = input.contact.name;
      set.contactRole = input.contact.role;
      set.contactPhone = input.contact.phone;
    }
    if (input.potentialAccounts !== undefined) set.potentialAccounts = input.potentialAccounts;
    if (input.note !== undefined) set.note = input.note;

    await updateWithVersion(prospect, id, input.version, set, { db: tx });
    const renamed = input.name !== undefined && input.name !== current.name;
    return {
      prospect: await getProspect(id, { db: tx }),
      duplicates: renamed ? await findDuplicates(id, { db: tx }) : [],
    };
  });
}

/** The archive preview (E4-S1 criterion 5, EC19): what archiving would cancel. */
export type ArchivePreview = { futureScheduledActivities: number };
/** Archive's answer: the record plus how many future Scheduled Activities it cancelled (EC19). */
export type ArchivedProspect = ProspectRecord & { cancelledActivities: number };

/** The Prospect's Scheduled Activities that start after now. Read from the activity table directly (docs/architecture.md). */
function futureScheduled(id: string) {
  return and(eq(activity.prospectId, id), eq(activity.status, "scheduled"), gt(activity.startsAt, sql`now()`));
}

/** How many future Scheduled Activities archiving would cancel. 404 for an unknown id. */
export async function getArchivePreview(id: string, { db = getDb() }: Options = {}): Promise<ArchivePreview> {
  await getProspect(id, { db });
  const [{ n }] = await db.select({ n: count() }).from(activity).where(futureScheduled(id));
  return { futureScheduledActivities: n };
}

/**
 * Archives a Prospect: it leaves the default list but can still be opened and restored (EC40), and
 * its future Scheduled Activities are cancelled in the same transaction (E4-S1 criterion 5, EC19).
 * Idempotent: an already archived Prospect is returned unchanged whatever the version, with
 * cancelledActivities 0.
 *
 * This is the single entry point for archiving, and it runs in one transaction with the row locked
 * (createActivity takes FOR SHARE on it, so no Activity can be added meanwhile).
 */
export async function archiveProspect(
  id: string,
  input: z.output<typeof prospectStatusInput>,
  { db = getDb() }: { db?: Db } = {},
): Promise<ArchivedProspect> {
  return db.transaction(async (tx) => {
    const current = await lockProspect(tx, id);
    let cancelledActivities = 0;
    if (current.archivedAt === null) {
      // EC19: a Prospect with an open Pipeline cannot be archived. On Hold does not block it (decided by
      // the user on 2026-11-19: "tunda" is a way out), and an On Hold Pipeline cannot be resumed while its
      // Prospect is archived. Starting, reopening and resuming take the same row lock.
      const [open] = await tx
        .select({ id: pipeline.id })
        .from(pipeline)
        .where(and(eq(pipeline.prospectId, id), isNull(pipeline.outcome)))
        .limit(1);
      if (open) throw invalidState(PROSPECT_HAS_OPEN_PIPELINE_MESSAGE, "prospect_has_open_pipeline");
      await updateWithVersion(prospect, id, input.version, { archivedAt: sql`now()` }, { db: tx });
      const cancelled = await tx
        .update(activity)
        .set({ status: "cancelled", version: sql`${activity.version} + 1`, updatedAt: sql`now()` })
        .where(futureScheduled(id))
        .returning({ id: activity.id });
      cancelledActivities = cancelled.length;
    }
    return { ...(await getProspect(id, { db: tx })), cancelledActivities };
  });
}

/** Restores an archived Prospect. Idempotent: one that is not archived is returned unchanged. */
export async function restoreProspect(
  id: string,
  input: z.output<typeof prospectStatusInput>,
  { db = getDb() }: { db?: Db } = {},
): Promise<ProspectRecord> {
  return db.transaction(async (tx) => {
    const current = await lockProspect(tx, id);
    if (current.archivedAt !== null) {
      await updateWithVersion(prospect, id, input.version, { archivedAt: null }, { db: tx });
    }
    return getProspect(id, { db: tx });
  });
}

/** A Stage on the map: shared by every marker at it (E6-S1). `count` is its Pipeline's Stage count. */
export type MapStage = { name: string; position: number; count: number };

/**
 * One marker (E6-S1 criterion 1), compact since up to 2,000 are sent at once (EC6, 500 KB budget).
 * `fundingOfficer` and `stage` are indexes into the response's `fundingOfficers` and `stages`.
 * `stage` and `outcome` are of the latest Pipeline: the open or On Hold one when there is one (a
 * reopened older Pipeline wins over a newer closed one), otherwise the most recently started; both
 * are null when the Prospect has no Pipeline.
 */
export type MapProspect = {
  id: string;
  name: string;
  category: ProspectCategory | null;
  lat: number;
  lng: number;
  fundingOfficer: number;
  stage: number | null;
  outcome: "won" | "lost" | "on_hold" | null;
};

export type MapProspects = { items: MapProspect[]; fundingOfficers: FundingOfficerRef[]; stages: MapStage[] };

type LatestPipeline = MapStage & { outcome: MapProspect["outcome"] };

const latestPipelineSql = sql<LatestPipeline | null>`(
  select json_build_object(
    'name', ${pipelineStage.name},
    'position', ${pipeline.currentStagePosition},
    'count', (select count(*)::int from ${pipelineStage} as all_stages where all_stages.pipeline_id = ${pipeline.id}),
    'outcome', ${pipeline.outcome}
  )
  from ${pipeline}
  join ${pipelineStage} on ${pipelineStage.pipelineId} = ${pipeline.id} and ${pipelineStage.position} = ${pipeline.currentStagePosition}
  where ${pipeline.prospectId} = ${prospect.id}
  order by (${pipeline.outcome} is null or ${pipeline.outcome} = 'on_hold') desc, ${pipeline.startedAt} desc, ${pipeline.id} desc
  limit 1
)`;

/** Rounds a coordinate to 6 decimals (about 0.1 m), enough for a marker and shorter on the wire. */
const coordinate = (value: number | null) => Math.round((value ?? 0) * 1e6) / 1e6;

/** The index of `value` in `list`, adding it under `key` the first time. */
function indexOf<T>(index: Map<string, number>, list: T[], key: string, value: T): number {
  let at = index.get(key);
  if (at === undefined) {
    at = list.push(value) - 1;
    index.set(key, at);
  }
  return at;
}

/**
 * Every non-archived Prospect with a location, sorted by name, for the map (E6-S1). Prospects
 * without a location are left out (EC34). Same Funding Officer and Stage filters as the list.
 * ponytail: no paging or bounding box; fine for the 2,000 Prospects of EC6. Add a bbox filter past ~5,000.
 */
export async function listMapProspects(
  query: z.output<typeof mapProspectQuery>,
  { db = getDb() }: Options = {},
): Promise<MapProspects> {
  const rows = await db
    .select({
      id: prospect.id,
      name: prospect.name,
      category: prospect.category,
      lat: prospect.lat,
      lng: prospect.lng,
      fundingOfficer: officerColumns,
      pipeline: latestPipelineSql,
    })
    .from(prospect)
    .innerJoin(fundingOfficer, eq(fundingOfficer.id, prospect.fundingOfficerId))
    .where(and(isNull(prospect.archivedAt), isNotNull(prospect.lat), ...officerAndStageFilters(db, query)))
    .orderBy(asc(prospect.nameKey), asc(prospect.id));

  const fundingOfficers: FundingOfficerRef[] = [];
  const stages: MapStage[] = [];
  const officerIndex = new Map<string, number>();
  const stageIndex = new Map<string, number>();
  const items = rows.map((row): MapProspect => {
    const latest = row.pipeline;
    return {
      id: row.id,
      name: row.name,
      category: row.category,
      lat: coordinate(row.lat),
      lng: coordinate(row.lng),
      fundingOfficer: indexOf(officerIndex, fundingOfficers, row.fundingOfficer.id, row.fundingOfficer),
      stage: latest
        ? indexOf(stageIndex, stages, JSON.stringify([latest.name, latest.position, latest.count]), {
            name: latest.name,
            position: latest.position,
            count: latest.count,
          })
        : null,
      outcome: latest?.outcome ?? null,
    };
  });
  return { items, fundingOfficers, stages };
}
