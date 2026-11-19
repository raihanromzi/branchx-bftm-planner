// Activities (E4-S1): field visits or meetings with a Prospect, for a Funding Officer, at a time
// stored in UTC. Scheduled → Cancelled here; Scheduled → Done only through a Check-in (E4-S3). Done
// and Cancelled are final (EC27). Never deleted (EC22). Route Handlers live in src/app/api/activities/
// (ADR 0003). The contract is in api.md, Activities.
//
// Concurrency: creating locks the Prospect's row FOR SHARE (archiveProspect takes FOR UPDATE, so an
// Activity cannot slip onto a Prospect being archived) and the linked Pipeline's row FOR SHARE (an
// Outcome change takes FOR UPDATE). Cancelling locks the Activity's row FOR UPDATE.
import "server-only";
import { type SQL, and, asc, eq, gte, lt, sql } from "drizzle-orm";
import type { z } from "zod";
import { activity, fundingOfficer, pipeline, pipelineStage, prospect } from "@/db/schema";
import { type Db, type Tx, getDb } from "@/server/db";
import { assertAssignableFundingOfficer } from "@/server/funding-officers";
import { ApiError, invalidState, notFound, updateWithVersion, versionConflict } from "@/server/http";
import { PROSPECT_ARCHIVED_MESSAGE } from "@/server/prospects";
import {
  ACTIVITY_STATUS_LABELS,
  type ActivityStatus,
  type PipelineOutcome,
  type activityListQuery,
  type activityStatusInput,
  type createActivityInput,
} from "@/server/validation";

export {
  ACTIVITY_STATUSES,
  ACTIVITY_STATUS_LABELS,
  DATE_RANGE_MESSAGE,
  STARTS_AT_MESSAGE,
  activityListQuery,
  activityStartsAt,
  activityStatusInput,
  createActivityInput,
} from "@/server/validation";

export const PROSPECT_NOT_FOUND_MESSAGE = "Prospect tidak ditemukan.";
export const PIPELINE_NOT_LINKABLE_MESSAGE = "Pipeline harus Pipeline berjalan milik Prospect ini.";
/** The idempotency scope of POST /api/activities. */
export const CREATE_SCOPE = "activity.create";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Options = { db?: Db | Tx; now?: Date };

/** The full record: GET /:id, create, cancel, and each list row. */
export type ActivityRecord = {
  id: string;
  prospect: { id: string; name: string; archived: boolean };
  fundingOfficer: { id: string; name: string; active: boolean };
  /** The linked Pipeline with its current state, or null. */
  pipeline: { id: string; outcome: PipelineOutcome | null; currentStage: { position: number; name: string } } | null;
  startsAt: Date;
  purpose: string;
  status: ActivityStatus;
  /** Scheduled and its time has passed (EC30). Never on Done or Cancelled. */
  overdue: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

const recordColumns = {
  activity,
  prospect: { id: prospect.id, name: prospect.name, archivedAt: prospect.archivedAt },
  fundingOfficer: { id: fundingOfficer.id, name: fundingOfficer.name, active: fundingOfficer.active },
  pipelineOutcome: pipeline.outcome,
  stagePosition: pipelineStage.position,
  stageName: pipelineStage.name,
};

function selectRecords(db: Db | Tx, where: SQL | undefined) {
  return db
    .select(recordColumns)
    .from(activity)
    .innerJoin(prospect, eq(prospect.id, activity.prospectId))
    .innerJoin(fundingOfficer, eq(fundingOfficer.id, activity.fundingOfficerId))
    .leftJoin(pipeline, eq(pipeline.id, activity.pipelineId))
    .leftJoin(
      pipelineStage,
      and(eq(pipelineStage.pipelineId, pipeline.id), eq(pipelineStage.position, pipeline.currentStagePosition)),
    )
    .where(where)
    .orderBy(asc(activity.startsAt), asc(activity.id));
}

type RecordRow = Awaited<ReturnType<typeof selectRecords>>[number];

function toRecord(row: RecordRow, now: Date): ActivityRecord {
  const a = row.activity;
  return {
    id: a.id,
    prospect: { id: row.prospect.id, name: row.prospect.name, archived: row.prospect.archivedAt !== null },
    fundingOfficer: row.fundingOfficer,
    pipeline:
      a.pipelineId === null
        ? null
        : {
            id: a.pipelineId,
            outcome: row.pipelineOutcome,
            currentStage: { position: row.stagePosition ?? 0, name: row.stageName ?? "" },
          },
    startsAt: a.startsAt,
    purpose: a.purpose,
    status: a.status,
    overdue: a.status === "scheduled" && a.startsAt.getTime() < now.getTime(),
    version: a.version,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

/** One Activity. 404 when the id is unknown or not a UUID. */
export async function getActivity(id: string, { db = getDb(), now = new Date() }: Options = {}): Promise<ActivityRecord> {
  if (!UUID.test(id)) throw notFound();
  const [row] = await selectRecords(db, eq(activity.id, id));
  if (!row) throw notFound();
  return toRecord(row, now);
}

/**
 * Every Activity starting on the WIB days `from` to `to` (both included), of any status, in time order
 * (E4-S1 criterion 4, EC8). Optionally one Funding Officer's.
 */
// ponytail: no page limit, since a week is about 100 Activities (brief); add a range cap if Jadwal ever asks for months.
export async function listActivities(
  query: z.output<typeof activityListQuery>,
  { db = getDb(), now = new Date() }: Options = {},
): Promise<ActivityRecord[]> {
  const rows = await selectRecords(
    db,
    and(
      gte(activity.startsAt, sql`(${query.from}::date)::timestamp at time zone 'Asia/Jakarta'`),
      lt(activity.startsAt, sql`(${query.to}::date + 1)::timestamp at time zone 'Asia/Jakarta'`),
      query.fundingOfficerId ? eq(activity.fundingOfficerId, query.fundingOfficerId) : undefined,
    ),
  );
  return rows.map((row) => toRecord(row, now));
}

/**
 * Every Overdue Activity (EC30): Scheduled and its time has passed, the same rule as `overdue` in
 * toRecord. Oldest first (E5-S1 criterion 5).
 */
// ponytail: no limit, since Overdue Activities are a handful per Funding Officer; add one if the dashboard ever pages them.
export async function listOverdueActivities({ db = getDb(), now = new Date() }: Options = {}): Promise<ActivityRecord[]> {
  const rows = await selectRecords(db, and(eq(activity.status, "scheduled"), lt(activity.startsAt, now)));
  return rows.map((row) => toRecord(row, now));
}

/**
 * Schedules an Activity and returns its id (E4-S1 criterion 1). Run inside withIdempotency's
 * transaction, so a refusal rolls back the key too. A time in the past is allowed (EC28).
 * 422 prospect_not_found, prospect_archived, the Funding Officer rule, and pipeline_not_linkable
 * (not an open Pipeline of this Prospect).
 */
export async function createActivity(input: z.output<typeof createActivityInput>, { db }: { db: Tx }): Promise<string> {
  const [target] = UUID.test(input.prospectId)
    ? await db
        .select({ archivedAt: prospect.archivedAt })
        .from(prospect)
        .where(eq(prospect.id, input.prospectId))
        .for("share")
    : [];
  if (!target) throw new ApiError(422, "prospect_not_found", PROSPECT_NOT_FOUND_MESSAGE);
  if (target.archivedAt !== null) throw invalidState(PROSPECT_ARCHIVED_MESSAGE, "prospect_archived");
  await assertAssignableFundingOfficer(db, input.fundingOfficerId);
  if (input.pipelineId !== null) {
    const [linked] = UUID.test(input.pipelineId)
      ? await db
          .select({ prospectId: pipeline.prospectId, outcome: pipeline.outcome })
          .from(pipeline)
          .where(eq(pipeline.id, input.pipelineId))
          .for("share")
      : [];
    if (!linked || linked.prospectId !== input.prospectId || linked.outcome !== null) {
      throw invalidState(PIPELINE_NOT_LINKABLE_MESSAGE, "pipeline_not_linkable");
    }
  }
  const [row] = await db
    .insert(activity)
    .values({
      prospectId: input.prospectId,
      fundingOfficerId: input.fundingOfficerId,
      pipelineId: input.pipelineId,
      startsAt: input.startsAt,
      purpose: input.purpose,
    })
    .returning({ id: activity.id });
  return row.id;
}

/**
 * Cancels a Scheduled Activity (E4-S1 criterion 3, EC27). 422 invalid_transition for Done or
 * Cancelled, whatever the version; 409 for a stale version; 404 for an unknown id.
 */
export async function cancelActivity(
  id: string,
  input: z.output<typeof activityStatusInput>,
  { db = getDb(), now }: { db?: Db; now?: Date } = {},
): Promise<ActivityRecord> {
  return db.transaction(async (tx) => {
    if (!UUID.test(id)) throw notFound();
    const [current] = await tx.select().from(activity).where(eq(activity.id, id)).for("update");
    if (!current) throw notFound();
    if (current.status !== "scheduled") {
      throw invalidState(
        `Kegiatan ini sudah ${ACTIVITY_STATUS_LABELS[current.status]}. Statusnya tidak bisa diubah.`,
        "invalid_transition",
      );
    }
    if (current.version !== input.version) throw versionConflict();
    await updateWithVersion(activity, id, input.version, { status: "cancelled" }, { db: tx });
    return getActivity(id, { db: tx, now });
  });
}
