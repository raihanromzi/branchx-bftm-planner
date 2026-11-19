// Pure helpers for the Pipeline Template editor (E3-S2): the editor's state, its mapping to and from the API
// (api.md, Pipeline Templates), reordering, the inline checks with the shared zod rules, and mapping the
// API's index-based field-error keys ("stages.2.name") onto the editor's own Stage and Task keys.
import { createPipelineTemplateInput } from "@/lib/validation";

/** A Task in the editor. `key` is the editor's own id: the API's ids change on every save. */
export type EditorTask = { key: string; name: string };
/** A Stage in the editor, with its Tasks in order. */
export type EditorStage = { key: string; name: string; tasks: EditorTask[] };
export type EditorValues = { name: string; stages: EditorStage[] };

/** A template as GET /api/pipeline-templates/:id returns it (api.md, "The record"). */
export type PipelineTemplateRecord = {
  id: string;
  name: string;
  archived: boolean;
  archivedAt: string | null;
  pipelineCount: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  stages: { id: string; position: number; name: string; tasks: { id: string; position: number; name: string }[] }[];
};

/** A row of GET /api/pipeline-templates. */
export type PipelineTemplateListItem = {
  id: string;
  name: string;
  stageCount: number;
  pipelineCount: number;
  archived: boolean;
  version: number;
  updatedAt: string;
};

let keyCounter = 0;
/** A key unique within this page load, for a new Stage or Task. */
export function newKey(prefix: "s" | "t"): string {
  keyCounter += 1;
  return `${prefix}${keyCounter}`;
}

export function emptyStage(): EditorStage {
  return { key: newKey("s"), name: "", tasks: [] };
}

/**
 * A new template starts with one empty Stage, ready to fill (docs/design/E3-S2.md). The page renders on the
 * server too, so this first Stage has a fixed key ("s0", which newKey never returns): its input ids match
 * between the server HTML and hydration.
 */
export function newTemplateValues(): EditorValues {
  return { name: "", stages: [{ key: "s0", name: "", tasks: [] }] };
}

export function valuesFromRecord(record: PipelineTemplateRecord): EditorValues {
  return {
    name: record.name,
    stages: [...record.stages]
      .sort((a, b) => a.position - b.position)
      .map((stage) => ({
        key: newKey("s"),
        name: stage.name,
        tasks: [...stage.tasks].sort((a, b) => a.position - b.position).map((task) => ({ key: newKey("t"), name: task.name })),
      })),
  };
}

/** The body for POST /api/pipeline-templates, and (with `version`) for PUT /api/pipeline-templates/:id. */
export function toApiBody(values: EditorValues) {
  return {
    name: values.name,
    stages: values.stages.map((stage) => ({ name: stage.name, tasks: stage.tasks.map((task) => ({ name: task.name })) })),
  };
}

/** Whether the editor differs from what was loaded (or from a new, empty template). */
export function isDirty(values: EditorValues, initial: EditorValues): boolean {
  return JSON.stringify(toApiBody(values)) !== JSON.stringify(toApiBody(initial));
}

/** Moves the item at `from` to `to` (both clamped to the list). Returns a new array; the same one when nothing moves. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const target = Math.max(0, Math.min(items.length - 1, to));
  if (from < 0 || from >= items.length || from === target) return items as T[];
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved);
  return next;
}

/**
 * The editor's error keys: "name", "stages" (the whole list), and per Stage or Task by its editor key:
 * "stage:<key>:name", "stage:<key>:tasks", "task:<key>:name". They follow a Stage or Task when it moves.
 */
export type EditorErrors = Record<string, string | undefined>;

export const stageNameKey = (stageKey: string) => `stage:${stageKey}:name`;
export const stageTasksKey = (stageKey: string) => `stage:${stageKey}:tasks`;
export const taskNameKey = (taskKey: string) => `task:${taskKey}:name`;

/**
 * Maps the API's field errors (zod paths with 0-based indexes into the Stages sent) onto the editor's keys,
 * using the Stages as they were sent. Keys the editor does not show (such as "version") go to `other`.
 */
export function toEditorErrors(
  fields: Record<string, string | undefined> | undefined,
  sent: readonly EditorStage[],
): { errors: EditorErrors; other: string[] } {
  const errors: EditorErrors = {};
  const other: string[] = [];
  for (const [path, message] of Object.entries(fields ?? {})) {
    if (!message) continue;
    if (path === "name" || path === "stages") {
      errors[path] ??= message;
      continue;
    }
    const match = /^stages\.(\d+)(?:\.(name|tasks)(?:\.(\d+)(?:\.(name))?)?)?$/.exec(path);
    const stage = match ? sent[Number(match[1])] : undefined;
    if (!match || !stage) {
      other.push(message);
      continue;
    }
    const [, , field, taskIndex] = match;
    let key: string | null = null;
    if (field === "name") key = stageNameKey(stage.key);
    else if (field === "tasks" && taskIndex === undefined) key = stageTasksKey(stage.key);
    else if (field === "tasks") {
      const task = stage.tasks[Number(taskIndex)];
      key = task ? taskNameKey(task.key) : stageTasksKey(stage.key);
    } else key = stageNameKey(stage.key);
    errors[key] ??= message;
  }
  return { errors, other };
}

/** The inline checks before saving, with the same rules and messages as the server. */
export function validateValues(values: EditorValues): EditorErrors {
  const result = createPipelineTemplateInput.safeParse(toApiBody(values));
  if (result.success) return {};
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join(".");
    fields[path] ??= issue.message;
  }
  return toEditorErrors(fields, values.stages).errors;
}

/** The order errors are shown on screen, to focus the first one: name, the list, then each Stage top to bottom. */
export function errorOrder(values: EditorValues): string[] {
  const order = ["name", "stages"];
  for (const stage of values.stages) {
    order.push(stageNameKey(stage.key));
    for (const task of stage.tasks) order.push(taskNameKey(task.key));
    order.push(stageTasksKey(stage.key));
  }
  return order;
}

export function firstErrorKey(errors: EditorErrors, values: EditorValues): string | null {
  return errorOrder(values).find((key) => errors[key]) ?? null;
}

/** "Identifikasi sekarang tahap 2." — announced after a Stage moves. A Stage without a name is "Tahap tanpa nama". */
export function stageMovedMessage(name: string, position: number): string {
  return `${displayStageName(name)} sekarang tahap ${position}.`;
}

/** "Hubungi Kontak sekarang tugas 1 di Pendekatan." — announced after a Task moves. */
export function taskMovedMessage(taskName: string, position: number, stageName: string): string {
  return `${taskName.trim() || "Tugas tanpa nama"} sekarang tugas ${position} di ${displayStageName(stageName)}.`;
}

export function displayStageName(name: string): string {
  return name.trim() || "Tahap tanpa nama";
}
