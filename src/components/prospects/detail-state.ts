import type { ActivityStatus, ActivityView, PipelineOutcome } from "@/lib/validation";
import type { ProspectRecord } from "./form-state";

// Pure rules for the Prospect detail (E2-S4, docs/design/E2-S4.md): which Pipeline is "berjalan", which
// actions are offered, and how Activities split into upcoming and past. No React, so unit tests reach them.

/** A row of GET /api/pipelines?prospectId= (api.md, Pipelines). */
export type PipelineSummary = {
  id: string;
  template: { id: string; name: string };
  fundingOfficer: { id: string; name: string; active: boolean };
  outcome: PipelineOutcome | null;
  accountsOpened: number | null;
  wonOn: string | null;
  lostReason: string | null;
  currentStage: { position: number; name: string };
  stageCount: number;
  tasksDone: number;
  tasksTotal: number;
  startedAt: string;
  closedAt: string | null;
  version: number;
};

/** A row of GET /api/activities?prospectId= (api.md, Activities). */
export type ActivitySummary = {
  id: string;
  fundingOfficer: { id: string; name: string; active: boolean };
  startsAt: string;
  purpose: string;
  status: ActivityStatus;
  overdue: boolean;
};

/** A row of GET /api/pipeline-templates. */
export type TemplateOption = { id: string; name: string; archived: boolean };

/** The Pipeline that is open or On Hold: at most one per Prospect (EC16). The list is newest first. */
export function runningPipeline(pipelines: PipelineSummary[]): PipelineSummary | null {
  return pipelines.find((pipeline) => pipeline.outcome === null || pipeline.outcome === "on_hold") ?? null;
}

/** Won and Lost Pipelines, newest first (the "Riwayat Pipeline"). */
export function closedPipelines(pipelines: PipelineSummary[]): PipelineSummary[] {
  return pipelines.filter((pipeline) => pipeline.outcome === "won" || pipeline.outcome === "lost");
}

/** "Mulai Pipeline" shows only with no open or On Hold Pipeline, and not on an archived Prospect (EC16). */
export function canStartPipeline(prospect: Pick<ProspectRecord, "archived">, pipelines: PipelineSummary[]): boolean {
  return !prospect.archived && runningPipeline(pipelines) === null;
}

/** An open Pipeline (no Outcome) blocks archiving; an On Hold one does not (EC19, decided 2026-11-19). */
export function archiveBlocked(pipelines: PipelineSummary[]): boolean {
  return pipelines.some((pipeline) => pipeline.outcome === null);
}

/** One list as loaded so far: its rows, the next cursor, and whether the server has more (api.md, Activities). */
export type ActivityPage = { items: ActivitySummary[]; hasMore: boolean; cursor?: string };

/** The first page of a list, from `GET /api/activities?prospectId=&view=`. */
export const firstActivityPage = (body: { items: ActivitySummary[]; hasMore: boolean }): ActivityPage => ({
  ...body,
  cursor: body.items.at(-1)?.id,
});

/**
 * Appends the next cursor page. A row already shown is skipped, so a repeated row is listed once.
 */
export function appendActivityPage(current: ActivityPage, body: { items: ActivitySummary[]; hasMore: boolean }): ActivityPage {
  const seen = new Set(current.items.map((item) => item.id));
  return {
    items: [...current.items, ...body.items.filter((item) => !seen.has(item.id))],
    hasMore: body.hasMore,
    cursor: body.items.at(-1)?.id ?? current.cursor,
  };
}

/** The query string for one list: the first page, or the page after `cursor` (the last id shown). */
export function activityQuery(prospectId: string, view: ActivityView, cursor?: string): string {
  return new URLSearchParams({ prospectId, view, ...(cursor ? { cursor } : {}) }).toString();
}

/** The template the "Mulai Pipeline" dialog starts with: the only active one, otherwise none (the Admin picks). */
export function defaultTemplateId(templates: TemplateOption[]): string {
  const active = templates.filter((template) => !template.archived);
  return active.length === 1 ? active[0].id : "";
}

/** A stored "+6281234567890" as a `tel:` link. Anything else is dialled as stored, without spaces or dashes. */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

/** "Lat, lng" under the mini map, four decimals. */
export function coordinateLine(location: { lat: number; lng: number }): string {
  return `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}`;
}
