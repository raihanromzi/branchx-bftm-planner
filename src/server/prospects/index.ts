// Prospects (E2-S1): the one list of institutions and venues the team works. Never deleted (EC22),
// only archived and restored. Route Handlers live in src/app/api/prospects/ (ADR 0003).
// ADR 0001: a Prospect is never an account holder; the only person stored is its Contact Person.
import "server-only";
import { type SQL, and, asc, count, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import type { z } from "zod";
import { fundingOfficer, prospect } from "@/db/schema";
import { type Db, type Tx, getDb } from "@/server/db";
import { assertAssignableFundingOfficer } from "@/server/funding-officers";
import { ApiError, notFound, updateWithVersion } from "@/server/http";
import {
  type ProspectCategory,
  type createProspectInput,
  type prospectListQuery,
  type prospectStatusInput,
  type updateProspectInput,
  prospectNameKey,
} from "@/server/validation";

export {
  PROSPECT_CATEGORIES,
  PROSPECT_NAME_MAX,
  createProspectInput,
  prospectListQuery,
  prospectNameKey,
  prospectStatusInput,
  updateProspectInput,
} from "@/server/validation";

export const PROSPECT_ARCHIVED_MESSAGE = "Prospect ini diarsipkan. Pulihkan dulu untuk mengubahnya.";
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

/** One row of the list. `openPipeline` is null until E3-S3 fills it. */
export type ProspectListItem = {
  id: string;
  name: string;
  category: ProspectCategory | null;
  fundingOfficer: FundingOfficerRef;
  hasLocation: boolean;
  potentialAccounts: number | null;
  archived: boolean;
  openPipeline: null;
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
  if (query.fundingOfficerId) conditions.push(eq(prospect.fundingOfficerId, query.fundingOfficerId));
  if (query.noLocation) conditions.push(isNull(prospect.lat));
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
    items: rows.map((row) => ({ ...row, openPipeline: null })),
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

/**
 * Archives a Prospect: it leaves the default list but can still be opened and restored (EC40).
 * Idempotent: an already archived Prospect is returned unchanged whatever the version.
 *
 * This is the single entry point for archiving, and it runs in one transaction with the row locked,
 * so the rules later stories add belong here, before the update: the open-Pipeline guard (E3-S3,
 * EC19) and cancelling the Prospect's future Activities (E4-S1).
 */
export async function archiveProspect(
  id: string,
  input: z.output<typeof prospectStatusInput>,
  { db = getDb() }: { db?: Db } = {},
): Promise<ProspectRecord> {
  return db.transaction(async (tx) => {
    const current = await lockProspect(tx, id);
    if (current.archivedAt === null) {
      await updateWithVersion(prospect, id, input.version, { archivedAt: sql`now()` }, { db: tx });
    }
    return getProspect(id, { db: tx });
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
