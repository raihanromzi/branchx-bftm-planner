// Pipeline Templates (E3-S1): reusable, ordered Stages, each with its Task checklist. A Pipeline copies
// its template's Stages and Tasks when it starts (E3-S3), so editing a template changes only new
// Pipelines (EC21). Route Handlers live in src/app/api/pipeline-templates/ (ADR 0003).
// The default template "Umum" is seeded by migration drizzle/0004_pipeline_template.sql.
import "server-only";
import { and, asc, count, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import type { z } from "zod";
import { pipeline, pipelineTemplate, templateStage, templateTask } from "@/db/schema";
import { type Db, type Tx, getDb } from "@/server/db";
import { ApiError, conflict, invalidState, notFound, updateWithVersion } from "@/server/http";
import {
  type createPipelineTemplateInput,
  type pipelineTemplateStatusInput,
  type updatePipelineTemplateInput,
  pipelineTemplateNameKey,
} from "@/server/validation";

export {
  PIPELINE_TEMPLATE_NAME_MAX,
  STAGES_MAX,
  STAGE_NAME_MAX,
  TASKS_PER_STAGE_MAX,
  TASK_NAME_MAX,
  createPipelineTemplateInput,
  pipelineTemplateNameKey,
  pipelineTemplateStatusInput,
  updatePipelineTemplateInput,
} from "@/server/validation";

export const PIPELINE_TEMPLATE_ARCHIVED_MESSAGE = "Template ini diarsipkan. Pulihkan dulu untuk mengubahnya.";
export const TEMPLATE_NAME_TAKEN_MESSAGE = "Nama template sudah dipakai.";
export const TEMPLATE_IN_USE_MESSAGE = "Template ini dipakai Pipeline. Arsipkan saja.";
export const LAST_TEMPLATE_MESSAGE = "Harus ada minimal satu template aktif.";
export const TEMPLATE_CANNOT_START_MESSAGE = "Template ini diarsipkan dan tidak bisa dipakai untuk Pipeline baru.";
export const TEMPLATE_NOT_FOUND_MESSAGE = "Template tidak ditemukan.";
/** The idempotency scope of POST /api/pipeline-templates. */
export const CREATE_SCOPE = "pipeline-template.create";
/** Templates are few; this only bounds a runaway response. */
export const LIST_LIMIT = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIVE_NAME_INDEX = "pipeline_template_active_name_key_idx";

type Options = { db?: Db | Tx };
type Row = typeof pipelineTemplate.$inferSelect;
type StagesInput = z.output<typeof createPipelineTemplateInput>["stages"];

export type TemplateTaskRecord = { id: string; position: number; name: string };
export type TemplateStageRecord = { id: string; position: number; name: string; tasks: TemplateTaskRecord[] };

/** The full template: GET /:id, create, PUT, archive and restore. Positions start at 1. */
export type PipelineTemplateRecord = {
  id: string;
  name: string;
  archived: boolean;
  archivedAt: Date | null;
  pipelineCount: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  stages: TemplateStageRecord[];
};

/** One row of the list. */
export type PipelineTemplateListItem = {
  id: string;
  name: string;
  stageCount: number;
  pipelineCount: number;
  archived: boolean;
  version: number;
  updatedAt: Date;
};

/** What a Pipeline copies when it starts (E3-S3): the ordered Stages and Task names. */
export type TemplateSnapshot = {
  id: string;
  name: string;
  stages: { position: number; name: string; tasks: { position: number; name: string }[] }[];
};

/** How many Pipelines (open, On Hold or closed) use each template: a grouped count over pipeline.template_id. */
async function pipelineCounts(db: Db | Tx, templateIds: string[]): Promise<Map<string, number>> {
  const counts = new Map(templateIds.map((id) => [id, 0]));
  if (templateIds.length === 0) return counts;
  const rows = await db
    .select({ templateId: pipeline.templateId, pipelines: count() })
    .from(pipeline)
    .where(inArray(pipeline.templateId, templateIds))
    .groupBy(pipeline.templateId);
  for (const row of rows) counts.set(row.templateId, row.pipelines);
  return counts;
}

/** How many Pipelines use the template: the rule behind DELETE (EC21) and `pipelineCount`. */
export async function countPipelinesUsingTemplate(db: Db | Tx, templateId: string): Promise<number> {
  return (await pipelineCounts(db, [templateId])).get(templateId) ?? 0;
}

/** The template's Stages, each with its Tasks, in order. */
async function readStages(db: Db | Tx, templateId: string): Promise<TemplateStageRecord[]> {
  const [stages, tasks] = await Promise.all([
    db
      .select({ id: templateStage.id, position: templateStage.position, name: templateStage.name })
      .from(templateStage)
      .where(eq(templateStage.templateId, templateId))
      .orderBy(asc(templateStage.position)),
    db
      .select({ stageId: templateTask.stageId, id: templateTask.id, position: templateTask.position, name: templateTask.name })
      .from(templateTask)
      .innerJoin(templateStage, eq(templateStage.id, templateTask.stageId))
      .where(eq(templateStage.templateId, templateId))
      .orderBy(asc(templateStage.position), asc(templateTask.position)),
  ]);
  return stages.map((stage) => ({
    ...stage,
    tasks: tasks.filter((task) => task.stageId === stage.id).map(({ id, position, name }) => ({ id, position, name })),
  }));
}

/** Active templates first, then archived ones; each group by name, ignoring case and repeated spaces. */
export async function listPipelineTemplates({ db = getDb() }: Options = {}): Promise<PipelineTemplateListItem[]> {
  const rows = await db
    .select({
      id: pipelineTemplate.id,
      name: pipelineTemplate.name,
      stageCount: sql<number>`count(${templateStage.id})`.mapWith(Number),
      archived: isNotNull(pipelineTemplate.archivedAt).mapWith(Boolean),
      version: pipelineTemplate.version,
      updatedAt: pipelineTemplate.updatedAt,
    })
    .from(pipelineTemplate)
    .leftJoin(templateStage, eq(templateStage.templateId, pipelineTemplate.id))
    .groupBy(pipelineTemplate.id)
    .orderBy(asc(isNotNull(pipelineTemplate.archivedAt)), asc(pipelineTemplate.nameKey), asc(pipelineTemplate.id))
    .limit(LIST_LIMIT);
  const counts = await pipelineCounts(db, rows.map((row) => row.id));
  return rows.map(({ id, name, stageCount, archived, version, updatedAt }) => ({
    id,
    name,
    stageCount,
    pipelineCount: counts.get(id) ?? 0,
    archived,
    version,
    updatedAt,
  }));
}

/** One template with its Stages and Tasks, archived or not. Throws 404 when the id is unknown or not a UUID. */
export async function getPipelineTemplate(id: string, { db = getDb() }: Options = {}): Promise<PipelineTemplateRecord> {
  if (!UUID.test(id)) throw notFound();
  const [row] = await db.select().from(pipelineTemplate).where(eq(pipelineTemplate.id, id));
  if (!row) throw notFound();
  return {
    id: row.id,
    name: row.name,
    archived: row.archivedAt !== null,
    archivedAt: row.archivedAt,
    pipelineCount: await countPipelinesUsingTemplate(db, id),
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    stages: await readStages(db, id),
  };
}

function nameTaken(): ApiError {
  return new ApiError(409, "template_name_taken", TEMPLATE_NAME_TAKEN_MESSAGE, { name: TEMPLATE_NAME_TAKEN_MESSAGE });
}

/** 409 template_name_taken when another active template has this name key. */
async function assertNameFree(db: Db | Tx, nameKey: string, exceptId?: string): Promise<void> {
  const [other] = await db
    .select({ id: pipelineTemplate.id })
    .from(pipelineTemplate)
    .where(
      and(
        eq(pipelineTemplate.nameKey, nameKey),
        isNull(pipelineTemplate.archivedAt),
        exceptId ? ne(pipelineTemplate.id, exceptId) : undefined,
      ),
    );
  if (other) throw nameTaken();
}

/** Maps the active-name unique index's violation (a race the pre-check missed) to 409 template_name_taken. */
async function guardActiveName<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    const pg = (error as { cause?: unknown }).cause ?? error;
    const { code, constraint_name: constraint } = pg as { code?: string; constraint_name?: string };
    if (code === "23505" && constraint === ACTIVE_NAME_INDEX) throw nameTaken();
    throw error;
  }
}

/** Inserts the Stages and their Tasks with positions 1, 2, 3… in the order given. */
async function insertStages(tx: Tx, templateId: string, stages: StagesInput): Promise<void> {
  const inserted = await tx
    .insert(templateStage)
    .values(stages.map((stage, index) => ({ templateId, position: index + 1, name: stage.name })))
    .returning({ id: templateStage.id, position: templateStage.position });
  const idAt = new Map(inserted.map((stage) => [stage.position, stage.id]));
  const tasks = stages.flatMap((stage, index) =>
    stage.tasks.map((task, taskIndex) => ({ stageId: idAt.get(index + 1)!, position: taskIndex + 1, name: task.name })),
  );
  if (tasks.length > 0) await tx.insert(templateTask).values(tasks);
}

/**
 * Inserts a template with its Stages and Tasks and returns its id. Run inside withIdempotency's
 * transaction, so a 409 for a taken name rolls back the key too.
 */
export async function createPipelineTemplate(
  input: z.output<typeof createPipelineTemplateInput>,
  { db }: { db: Tx },
): Promise<string> {
  const nameKey = pipelineTemplateNameKey(input.name);
  await assertNameFree(db, nameKey);
  const [row] = await guardActiveName(
    db.insert(pipelineTemplate).values({ name: input.name, nameKey }).returning({ id: pipelineTemplate.id }),
  );
  await insertStages(db, row.id, input.stages);
  return row.id;
}

/** Locks the template's row for this transaction. 404 when the id is unknown or not a UUID. */
async function lockTemplate(tx: Tx, id: string): Promise<Row> {
  if (!UUID.test(id)) throw notFound();
  const [row] = await tx.select().from(pipelineTemplate).where(eq(pipelineTemplate.id, id)).for("update");
  if (!row) throw notFound();
  return row;
}

/**
 * Saves the whole template: the name and the ordered Stages, each with its ordered Tasks, replace what
 * was there. Stages and Tasks are deleted and inserted again, so their ids change on every save; nothing
 * refers to them, because a Pipeline copies them when it starts (E3-S3, EC21).
 * 404 for an unknown id, 422 template_archived for an archived template, 409 for a stale version or a
 * name another active template has.
 */
export async function updatePipelineTemplate(
  id: string,
  input: z.output<typeof updatePipelineTemplateInput>,
  { db = getDb() }: { db?: Db } = {},
): Promise<PipelineTemplateRecord> {
  return db.transaction(async (tx) => {
    const current = await lockTemplate(tx, id);
    if (current.archivedAt !== null) throw invalidState(PIPELINE_TEMPLATE_ARCHIVED_MESSAGE, "template_archived");
    const nameKey = pipelineTemplateNameKey(input.name);
    await assertNameFree(tx, nameKey, id);
    await guardActiveName(updateWithVersion(pipelineTemplate, id, input.version, { name: input.name, nameKey }, { db: tx }));
    await tx.delete(templateStage).where(eq(templateStage.templateId, id));
    await insertStages(tx, id, input.stages);
    return getPipelineTemplate(id, { db: tx });
  });
}

/**
 * Serialises the changes that can leave no active template (archive and delete), so two of them at
 * once cannot each see the other template as the remaining one.
 */
async function lockActiveSet(tx: Tx): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('pipeline_template.active_set'))`);
}

/** 422 last_template when no other active template would remain. */
async function assertAnotherActive(tx: Tx, id: string): Promise<void> {
  const [other] = await tx
    .select({ id: pipelineTemplate.id })
    .from(pipelineTemplate)
    .where(and(isNull(pipelineTemplate.archivedAt), ne(pipelineTemplate.id, id)))
    .limit(1);
  if (!other) throw invalidState(LAST_TEMPLATE_MESSAGE, "last_template");
}

/**
 * Archives a template: it cannot start a new Pipeline, but Pipelines already started keep their Stages
 * (EC21). Idempotent: an archived template is returned unchanged whatever the version. 422
 * last_template when it is the only active template.
 */
export async function archivePipelineTemplate(
  id: string,
  input: z.output<typeof pipelineTemplateStatusInput>,
  { db = getDb() }: { db?: Db } = {},
): Promise<PipelineTemplateRecord> {
  return db.transaction(async (tx) => {
    await lockActiveSet(tx);
    const current = await lockTemplate(tx, id);
    if (current.archivedAt === null) {
      await assertAnotherActive(tx, id);
      await updateWithVersion(pipelineTemplate, id, input.version, { archivedAt: sql`now()` }, { db: tx });
    }
    return getPipelineTemplate(id, { db: tx });
  });
}

/**
 * Restores an archived template. Idempotent: an active one is returned unchanged. 409
 * template_name_taken when an active template has taken its name meanwhile.
 */
export async function restorePipelineTemplate(
  id: string,
  input: z.output<typeof pipelineTemplateStatusInput>,
  { db = getDb() }: { db?: Db } = {},
): Promise<PipelineTemplateRecord> {
  return db.transaction(async (tx) => {
    const current = await lockTemplate(tx, id);
    if (current.archivedAt !== null) {
      await assertNameFree(tx, current.nameKey, id);
      await guardActiveName(updateWithVersion(pipelineTemplate, id, input.version, { archivedAt: null }, { db: tx }));
    }
    return getPipelineTemplate(id, { db: tx });
  });
}

/**
 * Deletes a template no Pipeline uses, with its Stages and Tasks (EC21). 409 template_in_use when a
 * Pipeline uses it (archive it instead), 422 last_template when it is the only active template, 404
 * for an unknown id (so a repeat after success is 404).
 */
export async function deletePipelineTemplate(id: string, { db = getDb() }: { db?: Db } = {}): Promise<void> {
  await db.transaction(async (tx) => {
    await lockActiveSet(tx);
    const current = await lockTemplate(tx, id);
    if ((await countPipelinesUsingTemplate(tx, id)) > 0) throw conflict(TEMPLATE_IN_USE_MESSAGE, "template_in_use");
    if (current.archivedAt === null) await assertAnotherActive(tx, id);
    await tx.delete(pipelineTemplate).where(eq(pipelineTemplate.id, id));
  });
}

/**
 * The rule for starting a Pipeline (E3-S3, EC21): the template must exist and not be archived. Throws
 * ApiError 422 "template_archived_cannot_start" ("Template ini diarsipkan dan tidak bisa dipakai untuk
 * Pipeline baru.") or 422 "template_not_found" ("Template tidak ditemukan.").
 *
 * Call it inside the transaction that starts the Pipeline: the row is locked FOR SHARE, so an archive
 * or delete running at the same time waits until that transaction has committed.
 */
export async function assertTemplateCanStartPipeline(db: Db | Tx, id: string): Promise<void> {
  const [row] = UUID.test(id)
    ? await db
        .select({ archivedAt: pipelineTemplate.archivedAt })
        .from(pipelineTemplate)
        .where(eq(pipelineTemplate.id, id))
        .for("share")
    : [];
  if (!row) throw new ApiError(422, "template_not_found", TEMPLATE_NOT_FOUND_MESSAGE);
  if (row.archivedAt !== null) throw new ApiError(422, "template_archived_cannot_start", TEMPLATE_CANNOT_START_MESSAGE);
}

/** The ordered Stages and Task names a new Pipeline copies (E3-S3). 404 when the id is unknown. */
export async function getTemplateForSnapshot(db: Db | Tx, id: string): Promise<TemplateSnapshot> {
  if (!UUID.test(id)) throw notFound();
  const [row] = await db
    .select({ id: pipelineTemplate.id, name: pipelineTemplate.name })
    .from(pipelineTemplate)
    .where(eq(pipelineTemplate.id, id));
  if (!row) throw notFound();
  const stages = await readStages(db, id);
  return {
    id: row.id,
    name: row.name,
    stages: stages.map((stage) => ({
      position: stage.position,
      name: stage.name,
      tasks: stage.tasks.map((task) => ({ position: task.position, name: task.name })),
    })),
  };
}
