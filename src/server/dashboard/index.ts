// Targets and the dashboard summary (E5-S1). A Target is set per Funding Officer and month; Actual is
// computed from Won Pipelines on every read, never stored or entered (G4). Months are WIB calendar
// months: a Pipeline counts in the month of its Won date, which is itself a WIB day (EC31). Route
// Handlers live in src/app/api/targets/ and src/app/api/dashboard/ (ADR 0003). The contract is in
// api.md, Targets and Dashboard.
import "server-only";
import { and, asc, eq, gte, inArray, isNull, lt, or, sql, sum } from "drizzle-orm";
import type { z } from "zod";
import { fundingOfficer, pipeline, pipelineStage, pipelineTemplate, target } from "@/db/schema";
import { type Db, type Tx, getDb } from "@/server/db";
import { type ActivityRecord, listActivities, listOverdueActivities } from "@/server/activities";
import { assertAssignableFundingOfficer } from "@/server/funding-officers";
import { updateWithVersion, versionConflict } from "@/server/http";
import { type OverdueTask, listOverdueTasks } from "@/server/pipelines";
import { type setTargetInput, wibDate } from "@/server/validation";

export { TARGET_MAX, TARGET_MESSAGE, MONTH_MESSAGE, calendarMonth, monthQuery, setTargetInput } from "@/server/validation";

type Options = { db?: Db | Tx; now?: Date };
type FundingOfficerRef = { id: string; name: string; active: boolean };

/** "YYYY-MM" of the WIB calendar month `now` falls in. */
export function wibMonth(now: Date = new Date()): string {
  return wibDate(now).slice(0, 7);
}

/** The month `delta` months from "YYYY-MM". */
export function addMonths(month: string, delta: number): string {
  const [year, m] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, m - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

/** "YYYY-MM-DD" `days` days after the calendar day "YYYY-MM-DD". */
function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Sum of Accounts Opened on Pipelines Won in `month`, per the Pipeline's own Funding Officer (EC26). */
async function actualByFundingOfficer(db: Db | Tx, month: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ fundingOfficerId: pipeline.fundingOfficerId, actual: sum(pipeline.accountsOpened).mapWith(Number) })
    .from(pipeline)
    .where(
      and(
        eq(pipeline.outcome, "won"),
        gte(pipeline.wonOn, `${month}-01`),
        lt(pipeline.wonOn, `${addMonths(month, 1)}-01`),
      ),
    )
    .groupBy(pipeline.fundingOfficerId);
  return new Map(rows.map((row) => [row.fundingOfficerId, row.actual]));
}

async function targetsOf(db: Db | Tx, month: string) {
  const rows = await db
    .select({ fundingOfficerId: target.fundingOfficerId, accounts: target.accounts, version: target.version })
    .from(target)
    .where(eq(target.month, `${month}-01`));
  return new Map(rows.map((row) => [row.fundingOfficerId, row]));
}

/**
 * The Funding Officers a month reports on: every active one, and an inactive one only when it has a
 * Target or an Actual that month (design E5-S3). By name, ignoring case.
 */
async function officersFor(db: Db | Tx, ids: string[]): Promise<FundingOfficerRef[]> {
  return db
    .select({ id: fundingOfficer.id, name: fundingOfficer.name, active: fundingOfficer.active })
    .from(fundingOfficer)
    .where(ids.length > 0 ? or(eq(fundingOfficer.active, true), inArray(fundingOfficer.id, ids)) : eq(fundingOfficer.active, true))
    .orderBy(asc(sql`lower(${fundingOfficer.name})`), asc(fundingOfficer.id));
}

// Targets

/** One row of GET /api/targets: a Funding Officer's Target for the month, and its Actual for reference. */
export type TargetRow = {
  fundingOfficer: FundingOfficerRef;
  /** null when no Target is set for the month (EC4). */
  target: number | null;
  /** The Target's version, for PUT; null when none is set. */
  version: number | null;
  actual: number;
};

export type TargetMonth = { month: string; items: TargetRow[] };

/** Every reported Funding Officer's Target and Actual for `month` (E5-S2's screen). */
export async function listTargets(month: string, { db = getDb() }: Options = {}): Promise<TargetMonth> {
  const [targets, actual] = await Promise.all([targetsOf(db, month), actualByFundingOfficer(db, month)]);
  const officers = await officersFor(db, [...new Set([...targets.keys(), ...actual.keys()])]);
  return {
    month,
    items: officers.map((officer) => {
      const row = targets.get(officer.id);
      return {
        fundingOfficer: officer,
        target: row?.accounts ?? null,
        version: row?.version ?? null,
        actual: actual.get(officer.id) ?? 0,
      };
    }),
  };
}

export type TargetRecord = { fundingOfficerId: string; month: string; accounts: number; version: number };

/**
 * Sets one Funding Officer's Target for a month (E5-S1 criterion 1, EC17): inserts it when the month
 * has none (`version: null`), otherwise updates the one row with the version check (EC18). Sending the
 * value already stored answers it unchanged whatever the version, so a double tap is not a conflict.
 * 409 version_conflict when the row exists and the version is not its own (or null), or when another
 * request inserted it first. 422 for a Funding Officer that is unknown or inactive.
 */
export async function setTarget(input: z.output<typeof setTargetInput>, { db = getDb() }: { db?: Db } = {}): Promise<TargetRecord> {
  const month = `${input.month}-01`;
  const toRecord = (row: typeof target.$inferSelect): TargetRecord => ({
    fundingOfficerId: row.fundingOfficerId,
    month: input.month,
    accounts: row.accounts,
    version: row.version,
  });
  return db.transaction(async (tx) => {
    await assertAssignableFundingOfficer(tx, input.fundingOfficerId);
    const [current] = await tx
      .select()
      .from(target)
      .where(and(eq(target.fundingOfficerId, input.fundingOfficerId), eq(target.month, month)))
      .for("update");
    if (current) {
      if (current.accounts === input.accounts) return toRecord(current);
      if (input.version === null) throw versionConflict();
      return toRecord(await updateWithVersion(target, current.id, input.version, { accounts: input.accounts }, { db: tx }));
    }
    if (input.version !== null) throw versionConflict();
    const [inserted] = await tx
      .insert(target)
      .values({ fundingOfficerId: input.fundingOfficerId, month, accounts: input.accounts })
      .onConflictDoNothing({ target: [target.fundingOfficerId, target.month] })
      .returning();
    // A concurrent PUT inserted it between our read and insert: the client has not seen that row.
    if (!inserted) throw versionConflict();
    return toRecord(inserted);
  });
}

// The dashboard summary

/** Target, Actual and last month's Actual (E5-S1 criterion 4). `target` is null when none is set (EC4). */
export type Progress = { target: number | null; actual: number; previousActual: number };

export type StageCount = { position: number; name: string; count: number };
export type TemplateStageCounts = { template: { id: string; name: string }; stages: StageCount[] };

export type DashboardSummary = {
  month: string;
  previousMonth: string;
  /** Today in WIB, "YYYY-MM-DD". */
  today: string;
  team: Progress;
  fundingOfficers: (Progress & { fundingOfficer: FundingOfficerRef })[];
  /** Overdue now, whatever the month (EC30). */
  overdue: { tasks: OverdueTask[]; activities: ActivityRecord[] };
  /** Today's and the next 7 WIB days' Activities of any status (as GET /api/activities), in time order. Relative to today. */
  upcoming: { today: ActivityRecord[]; next7Days: ActivityRecord[] };
  /** Open Pipelines now, counted by Stage, grouped by template (E5-S1 criterion 6). */
  pipelinesByStage: TemplateStageCounts[];
};

/** Open Pipelines (no Outcome; On Hold is not open) by template, then Stage position and name. */
async function openPipelinesByStage(db: Db | Tx): Promise<TemplateStageCounts[]> {
  const rows = await db
    .select({
      templateId: pipelineTemplate.id,
      templateName: pipelineTemplate.name,
      position: pipelineStage.position,
      name: pipelineStage.name,
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(pipeline)
    .innerJoin(pipelineTemplate, eq(pipelineTemplate.id, pipeline.templateId))
    .innerJoin(
      pipelineStage,
      and(eq(pipelineStage.pipelineId, pipeline.id), eq(pipelineStage.position, pipeline.currentStagePosition)),
    )
    .where(isNull(pipeline.outcome))
    .groupBy(pipelineTemplate.id, pipelineTemplate.name, pipelineStage.position, pipelineStage.name)
    .orderBy(asc(sql`lower(${pipelineTemplate.name})`), asc(pipelineTemplate.id), asc(pipelineStage.position), asc(pipelineStage.name));
  const groups: TemplateStageCounts[] = [];
  for (const row of rows) {
    let group = groups.at(-1);
    if (group?.template.id !== row.templateId) {
      group = { template: { id: row.templateId, name: row.templateName }, stages: [] };
      groups.push(group);
    }
    group.stages.push({ position: row.position, name: row.name, count: row.count });
  }
  return groups;
}

/** The dashboard for `month` ("YYYY-MM", default the current WIB month). */
export async function getDashboard(month?: string, { db = getDb(), now = new Date() }: Options = {}): Promise<DashboardSummary> {
  const today = wibDate(now);
  month ??= today.slice(0, 7);
  const previousMonth = addMonths(month, -1);
  const [targets, actual, previous, overdueTasks, overdueActivities, upcoming, pipelinesByStage] = await Promise.all([
    targetsOf(db, month),
    actualByFundingOfficer(db, month),
    actualByFundingOfficer(db, previousMonth),
    listOverdueTasks({ db, now }),
    listOverdueActivities({ db, now }),
    listActivities({ from: today, to: addDays(today, 7) }, { db, now }),
    openPipelinesByStage(db),
  ]);
  const officers = await officersFor(db, [...new Set([...targets.keys(), ...actual.keys()])]);
  const total = (values: Iterable<number>) => [...values].reduce((a, b) => a + b, 0);
  const wibDay = (item: ActivityRecord) => wibDate(item.startsAt);
  return {
    month,
    previousMonth,
    today,
    team: {
      target: targets.size > 0 ? total([...targets.values()].map((row) => row.accounts)) : null,
      actual: total(actual.values()),
      previousActual: total(previous.values()),
    },
    fundingOfficers: officers.map((officer) => ({
      fundingOfficer: officer,
      target: targets.get(officer.id)?.accounts ?? null,
      actual: actual.get(officer.id) ?? 0,
      previousActual: previous.get(officer.id) ?? 0,
    })),
    overdue: { tasks: overdueTasks, activities: overdueActivities },
    upcoming: {
      today: upcoming.filter((item) => wibDay(item) === today),
      next7Days: upcoming.filter((item) => wibDay(item) !== today),
    },
    pipelinesByStage,
  };
}
