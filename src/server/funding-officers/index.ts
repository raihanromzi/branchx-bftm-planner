// Funding Officers (E1-S1): the team members work is assigned to. Never deleted (EC22), only
// deactivated and reactivated. Route Handlers live in src/app/api/funding-officers/ (ADR 0003).
import "server-only";
import { and, asc, count, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { activity, fundingOfficer, pipeline, prospect } from "@/db/schema";
import { type Db, type Tx, getDb } from "@/server/db";
import { ApiError, notFound, updateWithVersion } from "@/server/http";
import type { z } from "zod";
import type {
  createFundingOfficerInput,
  fundingOfficerStatusInput,
  updateFundingOfficerInput,
} from "@/server/validation";

export {
  FUNDING_OFFICER_NAME_MAX,
  createFundingOfficerInput,
  fundingOfficerStatusInput,
  updateFundingOfficerInput,
} from "@/server/validation";

export const FUNDING_OFFICER_INACTIVE_MESSAGE = "Funding Officer ini sudah nonaktif.";
export const FUNDING_OFFICER_NOT_FOUND_MESSAGE = "Funding Officer tidak ditemukan.";
/** The idempotency scope of POST /api/funding-officers. */
export const CREATE_SCOPE = "funding-officer.create";
/** The list is small (about 15); this only bounds a runaway response. */
export const LIST_LIMIT = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Row = typeof fundingOfficer.$inferSelect;

/** The record every endpoint returns. Dates serialise to ISO strings in JSON. */
export type FundingOfficerRecord = {
  id: string;
  name: string;
  phone: string;
  active: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

function toRecord(row: Row): FundingOfficerRecord {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    active: row.active,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

type Options = { db?: Db | Tx };

/** Active Funding Officers first, then inactive ones; each group by name, ignoring case. */
export async function listFundingOfficers({ db = getDb() }: Options = {}): Promise<FundingOfficerRecord[]> {
  const rows = await db
    .select()
    .from(fundingOfficer)
    .orderBy(desc(fundingOfficer.active), asc(sql`lower(${fundingOfficer.name})`), asc(fundingOfficer.id))
    .limit(LIST_LIMIT);
  return rows.map(toRecord);
}

/** One Funding Officer. Throws 404 when the id is unknown or not a UUID. */
export async function getFundingOfficer(id: string, { db = getDb() }: Options = {}): Promise<FundingOfficerRecord> {
  if (!UUID.test(id)) throw notFound();
  const [row] = await db.select().from(fundingOfficer).where(eq(fundingOfficer.id, id));
  if (!row) throw notFound();
  return toRecord(row);
}

/** Inserts an active Funding Officer and returns its id. Run inside withIdempotency's transaction. */
export async function createFundingOfficer(
  input: z.output<typeof createFundingOfficerInput>,
  { db = getDb() }: Options = {},
): Promise<string> {
  const [row] = await db
    .insert(fundingOfficer)
    .values({ name: input.name, phone: input.phone })
    .returning({ id: fundingOfficer.id });
  return row.id;
}

/** Changes the name and/or phone. 404 for an unknown id, 409 for a stale version. */
export async function updateFundingOfficer(
  id: string,
  input: z.output<typeof updateFundingOfficerInput>,
  { db = getDb() }: Options = {},
): Promise<FundingOfficerRecord> {
  const set: Partial<Pick<Row, "name" | "phone">> = {};
  if (input.name !== undefined) set.name = input.name;
  if (input.phone !== undefined) set.phone = input.phone;
  return toRecord(await updateWithVersion(fundingOfficer, id, input.version, set, { db }));
}

/**
 * Deactivates (active: false) or reactivates (active: true) a Funding Officer.
 * Idempotent: when it is already in that state, the record is returned unchanged whatever the
 * version, so a double tap or a retry is not a conflict. Otherwise the version is checked as for
 * any update (409 when stale) and incremented. 404 for an unknown id.
 * Deactivating changes nothing else: existing work keeps its Funding Officer (EC20, E1-S3).
 */
export async function setFundingOfficerActive(
  id: string,
  active: boolean,
  input: z.output<typeof fundingOfficerStatusInput>,
  { db = getDb() }: Options = {},
): Promise<FundingOfficerRecord> {
  const current = await getFundingOfficer(id, { db });
  if (current.active === active) return current;
  return toRecord(await updateWithVersion(fundingOfficer, id, input.version, { active }, { db }));
}

/** What a Funding Officer still owns, for the deactivation confirmation (E1-S3, EC20). */
export type DeactivationPreview = { prospects: number; openPipelines: number; futureScheduledActivities: number };

/**
 * Counts the Funding Officer's Prospects (not archived), open Pipelines (no Outcome, so On Hold is
 * left out, as in GLOSSARY.md) and Scheduled Activities that start after now. Each record is counted
 * by its own Funding Officer (EC26). Reads the tables directly: prospects, pipelines and activities
 * import this module, so importing theirs would make a cycle (docs/architecture.md). 404 for an unknown id.
 */
export async function getDeactivationPreview(id: string, { db = getDb() }: Options = {}): Promise<DeactivationPreview> {
  await getFundingOfficer(id, { db });
  const [[prospects], [openPipelines], [futureScheduledActivities]] = await Promise.all([
    db.select({ n: count() }).from(prospect).where(and(eq(prospect.fundingOfficerId, id), isNull(prospect.archivedAt))),
    db.select({ n: count() }).from(pipeline).where(and(eq(pipeline.fundingOfficerId, id), isNull(pipeline.outcome))),
    db
      .select({ n: count() })
      .from(activity)
      .where(and(eq(activity.fundingOfficerId, id), eq(activity.status, "scheduled"), gt(activity.startsAt, sql`now()`))),
  ]);
  return { prospects: prospects.n, openPipelines: openPipelines.n, futureScheduledActivities: futureScheduledActivities.n };
}

/**
 * The rule for every create or update that sets a Funding Officer on a Prospect, Pipeline or
 * Activity (E1-S1 criterion 3): the Funding Officer must exist and be active. Throws ApiError
 * 422 "funding_officer_inactive" ("Funding Officer ini sudah nonaktif.") or
 * 422 "funding_officer_not_found" ("Funding Officer tidak ditemukan.").
 *
 * Call it inside the transaction that writes the record: the row is locked FOR SHARE, so a
 * deactivation running at the same time waits until that transaction has committed.
 */
export async function assertAssignableFundingOfficer(db: Db | Tx, id: string): Promise<void> {
  const [row] = UUID.test(id)
    ? await db
        .select({ active: fundingOfficer.active })
        .from(fundingOfficer)
        .where(eq(fundingOfficer.id, id))
        .for("share")
    : [];
  if (!row) throw new ApiError(422, "funding_officer_not_found", FUNDING_OFFICER_NOT_FOUND_MESSAGE);
  if (!row.active) throw new ApiError(422, "funding_officer_inactive", FUNDING_OFFICER_INACTIVE_MESSAGE);
}
