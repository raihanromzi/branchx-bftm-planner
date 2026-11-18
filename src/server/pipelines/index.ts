// Pipelines (E3-S3): one acquisition attempt with one Prospect, moving through the Stages it copied
// from its template until it has an Outcome. Never deleted (EC22). Route Handlers live in
// src/app/api/pipelines/ and src/app/api/pipeline-tasks/ (ADR 0003). The contract is in api.md, Pipelines.
//
// Concurrency: every mutation runs in one transaction that locks the Pipeline's row (FOR UPDATE, or
// FOR SHARE for Task edits, which only need the Outcome to stay put). Starting and reopening also lock
// the Prospect's row FOR UPDATE, the same lock archiveProspect takes, so "one open or On Hold Pipeline
// per Prospect" and "no open Pipeline on an archived Prospect" hold under concurrency; the partial
// unique index pipeline_one_open_per_prospect_idx backs the first in the database.
import "server-only";
import { and, asc, count, desc, eq, gte, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { z } from "zod";
import { fundingOfficer, pipeline, pipelineStage, pipelineTask, pipelineTemplate, prospect } from "@/db/schema";
import { type Db, type Tx, getDb } from "@/server/db";
import { assertAssignableFundingOfficer } from "@/server/funding-officers";
import { ApiError, VALIDATION_MESSAGE, conflict, invalidState, notFound, updateWithVersion, versionConflict } from "@/server/http";
import { assertTemplateCanStartPipeline, getTemplateForSnapshot } from "@/server/pipeline-templates";
import { PROSPECT_ARCHIVED_MESSAGE } from "@/server/prospects";
import {
  type PipelineOutcome,
  WON_ON_FUTURE_MESSAGE,
  type changePipelineFundingOfficerInput,
  type movePipelineInput,
  type pipelineOutcomeInput,
  type pipelineStatusInput,
  type startPipelineInput,
  type updatePipelineTaskInput,
  wibDate,
} from "@/server/validation";

export {
  ACCOUNTS_OPENED_MAX,
  ACCOUNTS_OPENED_MESSAGE,
  PIPELINE_OUTCOMES,
  PIPELINE_OUTCOME_LABELS,
  WON_ON_FUTURE_MESSAGE,
  changePipelineFundingOfficerInput,
  movePipelineInput,
  pipelineListQuery,
  pipelineOutcomeInput,
  pipelineStatusInput,
  startPipelineInput,
  updatePipelineTaskInput,
  wibDate,
} from "@/server/validation";

export const PIPELINE_ALREADY_OPEN_MESSAGE = "Prospect ini masih punya Pipeline yang berjalan.";
export const REOPEN_BLOCKED_MESSAGE = "Prospect ini sudah punya Pipeline berjalan.";
export const PIPELINE_NOT_MOVABLE_MESSAGE = "Pipeline ini sudah selesai atau ditunda. Tahapnya tidak bisa diubah.";
export const TASKS_READ_ONLY_MESSAGE = "Pipeline ini sudah selesai atau ditunda. Tugasnya tidak bisa diubah.";
export const PIPELINE_CLOSED_MESSAGE = "Pipeline ini sudah selesai. Buka kembali dulu untuk mengubahnya.";
export const REOPEN_ONLY_CLOSED_MESSAGE = "Hanya Pipeline yang berhasil atau gagal yang bisa dibuka kembali.";
export const STAGE_NOT_FOUND_MESSAGE = "Tahap ini tidak ada di Pipeline ini.";
export const PROSPECT_NOT_FOUND_MESSAGE = "Prospect tidak ditemukan.";
/** The idempotency scope of POST /api/pipelines. */
export const START_SCOPE = "pipeline.start";
/** A Prospect has few Pipelines; this only bounds a runaway response. */
export const LIST_LIMIT = 100;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ONE_OPEN_INDEX = "pipeline_one_open_per_prospect_idx";

/** The state labels used in the invalid-transition message. "open" is a Pipeline with no Outcome. */
const STATE_LABELS: Record<PipelineOutcome | "open", string> = {
  open: "Berjalan",
  won: "Berhasil",
  lost: "Gagal",
  on_hold: "Ditunda",
};

/**
 * The Outcome transitions (E3-S3 criterion 5, EC24): from the current state (null = open) to the
 * requested one ("open" resumes). Reopening Won or Lost has its own endpoint (criterion 6).
 */
const TRANSITIONS: Record<PipelineOutcome | "open", (PipelineOutcome | "open")[]> = {
  open: ["won", "lost", "on_hold"],
  on_hold: ["open", "lost"],
  won: [],
  lost: [],
};

type Options = { db?: Db | Tx; now?: Date };
type MutationOptions = { db?: Db; now?: Date };
type Row = typeof pipeline.$inferSelect;
type FundingOfficerRef = { id: string; name: string; active: boolean };

export type PipelineTaskRecord = {
  id: string;
  position: number;
  name: string;
  /** "YYYY-MM-DD" or null. */
  dueOn: string | null;
  done: boolean;
  doneAt: Date | null;
  /** Due date before today in WIB, unticked, on an open Pipeline (EC30). Never on Won, Lost or On Hold. */
  overdue: boolean;
  version: number;
};

export type PipelineStageRecord = {
  id: string;
  position: number;
  name: string;
  tasksDone: number;
  tasksTotal: number;
  tasks: PipelineTaskRecord[];
};

/** The full record: GET /:id and every mutation's answer. */
export type PipelineRecord = {
  id: string;
  prospect: { id: string; name: string; archived: boolean };
  template: { id: string; name: string };
  fundingOfficer: FundingOfficerRef;
  /** null while the Pipeline is open. */
  outcome: PipelineOutcome | null;
  accountsOpened: number | null;
  wonOn: string | null;
  lostReason: string | null;
  currentStagePosition: number;
  currentStage: { id: string; position: number; name: string };
  stageCount: number;
  tasksDone: number;
  tasksTotal: number;
  /** The Prospect has another open or On Hold Pipeline, so this one cannot be reopened (EC25). */
  prospectHasOtherOpenPipeline: boolean;
  startedAt: Date;
  closedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  stages: PipelineStageRecord[];
};

/** One row of GET /api/pipelines?prospectId=: a Prospect's Pipelines, newest first. */
export type PipelineSummary = {
  id: string;
  template: { id: string; name: string };
  fundingOfficer: FundingOfficerRef;
  outcome: PipelineOutcome | null;
  accountsOpened: number | null;
  wonOn: string | null;
  lostReason: string | null;
  currentStage: { position: number; name: string };
  stageCount: number;
  tasksDone: number;
  tasksTotal: number;
  startedAt: Date;
  closedAt: Date | null;
  version: number;
};

const officerColumns = { id: fundingOfficer.id, name: fundingOfficer.name, active: fundingOfficer.active };

/** Open or On Hold: the Pipelines a Prospect may have only one of (EC16). */
export function isOpenOrOnHold() {
  return or(isNull(pipeline.outcome), eq(pipeline.outcome, "on_hold"));
}

/** The pipeline's Stage count and Task counts, by correlated subqueries (used by the list and the summaries). */
const stageCountSql = sql<number>`(select count(*) from ${pipelineStage} where ${pipelineStage.pipelineId} = ${pipeline.id})`.mapWith(Number);
const tasksTotalSql = sql<number>`(select count(*) from ${pipelineTask} join ${pipelineStage} on ${pipelineStage.id} = ${pipelineTask.stageId} where ${pipelineStage.pipelineId} = ${pipeline.id})`.mapWith(Number);
const tasksDoneSql = sql<number>`(select count(*) from ${pipelineTask} join ${pipelineStage} on ${pipelineStage.id} = ${pipelineTask.stageId} where ${pipelineStage.pipelineId} = ${pipeline.id} and ${pipelineTask.doneAt} is not null)`.mapWith(Number);

/** One Pipeline with its Stages and Tasks. 404 when the id is unknown or not a UUID. */
export async function getPipeline(id: string, { db = getDb(), now = new Date() }: Options = {}): Promise<PipelineRecord> {
  if (!UUID.test(id)) throw notFound();
  const [row] = await db
    .select({
      pipeline,
      prospect: { id: prospect.id, name: prospect.name, archivedAt: prospect.archivedAt },
      template: { id: pipelineTemplate.id, name: pipelineTemplate.name },
      fundingOfficer: officerColumns,
    })
    .from(pipeline)
    .innerJoin(prospect, eq(prospect.id, pipeline.prospectId))
    .innerJoin(pipelineTemplate, eq(pipelineTemplate.id, pipeline.templateId))
    .innerJoin(fundingOfficer, eq(fundingOfficer.id, pipeline.fundingOfficerId))
    .where(eq(pipeline.id, id));
  if (!row) throw notFound();

  const [stages, tasks, [other]] = await Promise.all([
    db
      .select({ id: pipelineStage.id, position: pipelineStage.position, name: pipelineStage.name })
      .from(pipelineStage)
      .where(eq(pipelineStage.pipelineId, id))
      .orderBy(asc(pipelineStage.position)),
    db
      .select({
        stageId: pipelineTask.stageId,
        id: pipelineTask.id,
        position: pipelineTask.position,
        name: pipelineTask.name,
        dueOn: pipelineTask.dueOn,
        doneAt: pipelineTask.doneAt,
        version: pipelineTask.version,
      })
      .from(pipelineTask)
      .innerJoin(pipelineStage, eq(pipelineStage.id, pipelineTask.stageId))
      .where(eq(pipelineStage.pipelineId, id))
      .orderBy(asc(pipelineStage.position), asc(pipelineTask.position)),
    db
      .select({ id: pipeline.id })
      .from(pipeline)
      .where(and(eq(pipeline.prospectId, row.pipeline.prospectId), ne(pipeline.id, id), isOpenOrOnHold()))
      .limit(1),
  ]);

  const open = row.pipeline.outcome === null;
  const today = wibDate(now);
  const stageRecords: PipelineStageRecord[] = stages.map((stage) => {
    const stageTasks = tasks
      .filter((task) => task.stageId === stage.id)
      .map(({ id: taskId, position, name, dueOn, doneAt, version }) => ({
        id: taskId,
        position,
        name,
        dueOn,
        done: doneAt !== null,
        doneAt,
        overdue: open && doneAt === null && dueOn !== null && dueOn < today,
        version,
      }));
    return {
      ...stage,
      tasksDone: stageTasks.filter((task) => task.done).length,
      tasksTotal: stageTasks.length,
      tasks: stageTasks,
    };
  });
  const current = stageRecords.find((stage) => stage.position === row.pipeline.currentStagePosition) ?? stageRecords[0];
  const p = row.pipeline;
  return {
    id: p.id,
    prospect: { id: row.prospect.id, name: row.prospect.name, archived: row.prospect.archivedAt !== null },
    template: row.template,
    fundingOfficer: row.fundingOfficer,
    outcome: p.outcome,
    accountsOpened: p.accountsOpened,
    wonOn: p.wonOn,
    lostReason: p.lostReason,
    currentStagePosition: p.currentStagePosition,
    currentStage: { id: current.id, position: current.position, name: current.name },
    stageCount: stageRecords.length,
    tasksDone: tasks.filter((task) => task.doneAt !== null).length,
    tasksTotal: tasks.length,
    prospectHasOtherOpenPipeline: other !== undefined,
    startedAt: p.startedAt,
    closedAt: p.closedAt,
    version: p.version,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    stages: stageRecords,
  };
}

/** A Prospect's Pipelines, newest first (E2-S4): the open or On Hold one and the closed ones. */
export async function listPipelinesForProspect(prospectId: string, { db = getDb() }: Options = {}): Promise<PipelineSummary[]> {
  const rows = await db
    .select({
      id: pipeline.id,
      template: { id: pipelineTemplate.id, name: pipelineTemplate.name },
      fundingOfficer: officerColumns,
      outcome: pipeline.outcome,
      accountsOpened: pipeline.accountsOpened,
      wonOn: pipeline.wonOn,
      lostReason: pipeline.lostReason,
      currentStage: { position: pipelineStage.position, name: pipelineStage.name },
      stageCount: stageCountSql,
      tasksDone: tasksDoneSql,
      tasksTotal: tasksTotalSql,
      startedAt: pipeline.startedAt,
      closedAt: pipeline.closedAt,
      version: pipeline.version,
    })
    .from(pipeline)
    .innerJoin(pipelineTemplate, eq(pipelineTemplate.id, pipeline.templateId))
    .innerJoin(fundingOfficer, eq(fundingOfficer.id, pipeline.fundingOfficerId))
    .innerJoin(
      pipelineStage,
      and(eq(pipelineStage.pipelineId, pipeline.id), eq(pipelineStage.position, pipeline.currentStagePosition)),
    )
    .where(eq(pipeline.prospectId, prospectId))
    .orderBy(desc(pipeline.startedAt), desc(pipeline.id))
    .limit(LIST_LIMIT);
  return rows;
}

/** Maps a violation of the one-open-Pipeline index (a race the pre-check missed) to the 409. */
async function guardOneOpen<T>(work: Promise<T>, message: string): Promise<T> {
  try {
    return await work;
  } catch (error) {
    const pg = (error as { cause?: unknown }).cause ?? error;
    const { code, constraint_name: constraint } = pg as { code?: string; constraint_name?: string };
    if (code === "23505" && constraint === ONE_OPEN_INDEX) throw conflict(message, "pipeline_already_open");
    throw error;
  }
}

/** Locks the Prospect's row (the lock archiveProspect takes). 422 prospect_not_found when it does not exist. */
async function lockProspect(tx: Tx, id: string) {
  const [row] = UUID.test(id)
    ? await tx
        .select({ id: prospect.id, archivedAt: prospect.archivedAt, fundingOfficerId: prospect.fundingOfficerId })
        .from(prospect)
        .where(eq(prospect.id, id))
        .for("update")
    : [];
  return row;
}

/** Another open or On Hold Pipeline of the Prospect, other than `exceptId`. */
async function hasOpenPipeline(db: Db | Tx, prospectId: string, exceptId?: string): Promise<boolean> {
  const [row] = await db
    .select({ id: pipeline.id })
    .from(pipeline)
    .where(and(eq(pipeline.prospectId, prospectId), isOpenOrOnHold(), exceptId ? ne(pipeline.id, exceptId) : undefined))
    .limit(1);
  return row !== undefined;
}

/**
 * Starts a Pipeline and returns its id (E3-S3 criterion 1). Run inside withIdempotency's transaction,
 * so a refusal rolls back the key too. Copies the template's Stages and Tasks (EC21) and the
 * Prospect's Funding Officer, and starts at the first Stage.
 * 422 prospect_not_found, 422 prospect_archived, 409 pipeline_already_open (EC16), the template rule
 * (422 template_archived_cannot_start / template_not_found) and the Funding Officer rule (422).
 */
export async function startPipeline(input: z.output<typeof startPipelineInput>, { db }: { db: Tx }): Promise<string> {
  const target = await lockProspect(db, input.prospectId);
  if (!target) throw new ApiError(422, "prospect_not_found", PROSPECT_NOT_FOUND_MESSAGE);
  if (target.archivedAt !== null) throw invalidState(PROSPECT_ARCHIVED_MESSAGE, "prospect_archived");
  if (await hasOpenPipeline(db, target.id)) throw conflict(PIPELINE_ALREADY_OPEN_MESSAGE, "pipeline_already_open");
  await assertTemplateCanStartPipeline(db, input.templateId);
  // The Pipeline gets the Prospect's Funding Officer, so it must still be assignable (E1-S1 criterion 3).
  await assertAssignableFundingOfficer(db, target.fundingOfficerId);
  const snapshot = await getTemplateForSnapshot(db, input.templateId);

  const [row] = await guardOneOpen(
    db
      .insert(pipeline)
      .values({
        prospectId: target.id,
        templateId: snapshot.id,
        fundingOfficerId: target.fundingOfficerId,
        currentStagePosition: snapshot.stages[0].position,
      })
      .returning({ id: pipeline.id }),
    PIPELINE_ALREADY_OPEN_MESSAGE,
  );
  const stages = await db
    .insert(pipelineStage)
    .values(snapshot.stages.map((stage) => ({ pipelineId: row.id, position: stage.position, name: stage.name })))
    .returning({ id: pipelineStage.id, position: pipelineStage.position });
  const idAt = new Map(stages.map((stage) => [stage.position, stage.id]));
  const tasks = snapshot.stages.flatMap((stage) =>
    stage.tasks.map((task) => ({ stageId: idAt.get(stage.position)!, position: task.position, name: task.name })),
  );
  if (tasks.length > 0) await db.insert(pipelineTask).values(tasks);
  return row.id;
}

/** Locks the Pipeline's row for this transaction. 404 when the id is unknown or not a UUID. */
async function lockPipeline(tx: Tx, id: string): Promise<Row> {
  if (!UUID.test(id)) throw notFound();
  const [row] = await tx.select().from(pipeline).where(eq(pipeline.id, id)).for("update");
  if (!row) throw notFound();
  return row;
}

/** 409 version_conflict when the client's version is not the locked row's. */
function assertVersion(current: { version: number }, version: number): void {
  if (current.version !== version) throw versionConflict();
}

function fieldError(field: string, message: string): ApiError {
  return new ApiError(400, "validation", VALIDATION_MESSAGE, { [field]: message });
}

export type MoveResult = { pipeline: PipelineRecord; uncheckedTasksLeftBehind: number };

/**
 * Moves an open Pipeline to any of its Stages, forward or back (E3-S3 criterion 3, EC23). A forward
 * move reports how many unticked Tasks are in the Stages it leaves behind: from the current Stage up
 * to, not including, the target. A move back, or to the current Stage (a no-op that writes nothing and
 * does not check the version), reports 0. 422 pipeline_closed for Won, Lost or On Hold; 400 for a
 * position the Pipeline does not have; 409 for a stale version.
 */
export async function movePipeline(
  id: string,
  input: z.output<typeof movePipelineInput>,
  { db = getDb(), now }: MutationOptions = {},
): Promise<MoveResult> {
  return db.transaction(async (tx) => {
    const current = await lockPipeline(tx, id);
    if (current.outcome !== null) throw invalidState(PIPELINE_NOT_MOVABLE_MESSAGE, "pipeline_closed");
    const [{ stages }] = await tx.select({ stages: count() }).from(pipelineStage).where(eq(pipelineStage.pipelineId, id));
    if (input.stagePosition > stages) throw fieldError("stagePosition", STAGE_NOT_FOUND_MESSAGE);
    if (input.stagePosition === current.currentStagePosition) {
      return { pipeline: await getPipeline(id, { db: tx, now }), uncheckedTasksLeftBehind: 0 };
    }
    assertVersion(current, input.version);

    let uncheckedTasksLeftBehind = 0;
    if (input.stagePosition > current.currentStagePosition) {
      const [{ unchecked }] = await tx
        .select({ unchecked: count() })
        .from(pipelineTask)
        .innerJoin(pipelineStage, eq(pipelineStage.id, pipelineTask.stageId))
        .where(
          and(
            eq(pipelineStage.pipelineId, id),
            gte(pipelineStage.position, current.currentStagePosition),
            lt(pipelineStage.position, input.stagePosition),
            isNull(pipelineTask.doneAt),
          ),
        );
      uncheckedTasksLeftBehind = unchecked;
    }
    await updateWithVersion(pipeline, id, input.version, { currentStagePosition: input.stagePosition }, { db: tx });
    return { pipeline: await getPipeline(id, { db: tx, now }), uncheckedTasksLeftBehind };
  });
}

/**
 * Sets the Outcome along the transitions in TRANSITIONS (E3-S3 criterion 5, EC24): Open → Won, Lost or
 * On Hold; On Hold → Open (the same Stage) or Lost. Anything else is 422 invalid_transition.
 * Won needs Accounts Opened (validated by the schema) and a Won date not after today in WIB (EC32,
 * 400 fields.wonOn); `now` is injectable for tests. Lost needs a reason. Won and Lost set closed_at.
 */
export async function setPipelineOutcome(
  id: string,
  input: z.output<typeof pipelineOutcomeInput>,
  { db = getDb(), now = new Date() }: MutationOptions = {},
): Promise<PipelineRecord> {
  return db.transaction(async (tx) => {
    const current = await lockPipeline(tx, id);
    assertVersion(current, input.version);
    const from = current.outcome ?? "open";
    if (!TRANSITIONS[from].includes(input.outcome)) {
      throw invalidState(
        `Hasil Pipeline tidak bisa diubah dari ${STATE_LABELS[from]} ke ${STATE_LABELS[input.outcome]}.`,
        "invalid_transition",
      );
    }

    let set: Partial<Row>;
    switch (input.outcome) {
      case "won":
        if (input.wonOn > wibDate(now)) throw fieldError("wonOn", WON_ON_FUTURE_MESSAGE);
        set = { outcome: "won", accountsOpened: input.accountsOpened, wonOn: input.wonOn, closedAt: now };
        break;
      case "lost":
        set = { outcome: "lost", lostReason: input.lostReason, closedAt: now };
        break;
      case "on_hold":
        set = { outcome: "on_hold" };
        break;
      case "open":
        set = { outcome: null };
        break;
    }
    await updateWithVersion(pipeline, id, input.version, set, { db: tx });
    return getPipeline(id, { db: tx, now });
  });
}

/**
 * Reopens a Won or Lost Pipeline (E3-S3 criterion 6, EC25): clears the Outcome, Accounts Opened, the
 * Won date, the Lost reason and closed_at, and it carries on at the Stage it was in. 422
 * invalid_transition when it is open or On Hold; 422 prospect_archived when its Prospect is archived;
 * 409 pipeline_already_open ("Prospect ini sudah punya Pipeline berjalan.") when the Prospect has
 * another open or On Hold Pipeline; 409 for a stale version.
 */
export async function reopenPipeline(
  id: string,
  input: z.output<typeof pipelineStatusInput>,
  { db = getDb(), now }: MutationOptions = {},
): Promise<PipelineRecord> {
  return db.transaction(async (tx) => {
    const current = await lockPipeline(tx, id);
    assertVersion(current, input.version);
    if (current.outcome !== "won" && current.outcome !== "lost") {
      throw invalidState(REOPEN_ONLY_CLOSED_MESSAGE, "invalid_transition");
    }
    const owner = await lockProspect(tx, current.prospectId);
    if (owner?.archivedAt != null) throw invalidState(PROSPECT_ARCHIVED_MESSAGE, "prospect_archived");
    if (await hasOpenPipeline(tx, current.prospectId, id)) throw conflict(REOPEN_BLOCKED_MESSAGE, "pipeline_already_open");
    await guardOneOpen(
      updateWithVersion(
        pipeline,
        id,
        input.version,
        { outcome: null, accountsOpened: null, wonOn: null, lostReason: null, closedAt: null },
        { db: tx },
      ),
      REOPEN_BLOCKED_MESSAGE,
    );
    return getPipeline(id, { db: tx, now });
  });
}

/**
 * Changes the Pipeline's own Funding Officer (E3-S3 criterion 7, EC26); the Prospect's is unchanged.
 * Allowed while open or On Hold; 422 pipeline_closed on Won or Lost (reopen first, since Actual follows
 * the Pipeline's Funding Officer). The Funding Officer rule (422) applies only when it changes.
 */
export async function changePipelineFundingOfficer(
  id: string,
  input: z.output<typeof changePipelineFundingOfficerInput>,
  { db = getDb(), now }: MutationOptions = {},
): Promise<PipelineRecord> {
  return db.transaction(async (tx) => {
    const current = await lockPipeline(tx, id);
    assertVersion(current, input.version);
    if (current.outcome === "won" || current.outcome === "lost") throw invalidState(PIPELINE_CLOSED_MESSAGE, "pipeline_closed");
    if (input.fundingOfficerId !== current.fundingOfficerId) {
      await assertAssignableFundingOfficer(tx, input.fundingOfficerId);
    }
    await updateWithVersion(pipeline, id, input.version, { fundingOfficerId: input.fundingOfficerId }, { db: tx });
    return getPipeline(id, { db: tx, now });
  });
}

/**
 * Locks the Task's row FOR UPDATE and its Pipeline's FOR SHARE (so the Outcome cannot change
 * meanwhile). 404 for an unknown Task; 422 pipeline_closed when the Pipeline is Won, Lost or On Hold
 * (Tasks are read-only then, docs/design/E3-S4.md).
 */
async function lockEditableTask(tx: Tx, taskId: string) {
  if (!UUID.test(taskId)) throw notFound();
  const [owner] = await tx
    .select({ pipelineId: pipelineStage.pipelineId })
    .from(pipelineTask)
    .innerJoin(pipelineStage, eq(pipelineStage.id, pipelineTask.stageId))
    .where(eq(pipelineTask.id, taskId));
  if (!owner) throw notFound();
  const [parent] = await tx
    .select({ outcome: pipeline.outcome })
    .from(pipeline)
    .where(eq(pipeline.id, owner.pipelineId))
    .for("share");
  const [task] = await tx.select().from(pipelineTask).where(eq(pipelineTask.id, taskId)).for("update");
  if (!task || !parent) throw notFound();
  if (parent.outcome !== null) throw invalidState(TASKS_READ_ONLY_MESSAGE, "pipeline_closed");
  return { task, pipelineId: owner.pipelineId };
}

/**
 * Ticks, unticks or sets the due date of one Task (E3-S3 criterion 4), checked against the Task's own
 * version. A request that changes nothing (ticking a ticked Task, the same due date) writes nothing and
 * does not check the version, so a double tap is harmless; any real change with a stale version is 409,
 * so a tick from another tab never silently overwrites a due-date edit. Answers the whole Pipeline.
 */
export async function updatePipelineTask(
  taskId: string,
  input: z.output<typeof updatePipelineTaskInput>,
  { db = getDb(), now }: MutationOptions = {},
): Promise<PipelineRecord> {
  return db.transaction(async (tx) => {
    const { task, pipelineId } = await lockEditableTask(tx, taskId);
    const set: { doneAt?: Date | null; dueOn?: string | null } = {};
    if (input.done !== undefined && input.done !== (task.doneAt !== null)) set.doneAt = input.done ? (now ?? new Date()) : null;
    if (input.dueOn !== undefined && input.dueOn !== task.dueOn) set.dueOn = input.dueOn;
    if (Object.keys(set).length > 0) await updateWithVersion(pipelineTask, taskId, input.version, set, { db: tx });
    return getPipeline(pipelineId, { db: tx, now });
  });
}

/**
 * Removes one Task from its Pipeline (E3-S3 criterion 4, EC22): the only delete a Pipeline allows.
 * The template is unchanged. 404 for an unknown Task (so a repeat is 404); 422 pipeline_closed when
 * the Pipeline is Won, Lost or On Hold.
 */
export async function deletePipelineTask(taskId: string, { db = getDb() }: { db?: Db } = {}): Promise<void> {
  await db.transaction(async (tx) => {
    await lockEditableTask(tx, taskId);
    await tx.delete(pipelineTask).where(eq(pipelineTask.id, taskId));
  });
}
