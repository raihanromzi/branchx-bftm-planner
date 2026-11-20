"use client";

import { ArchiveRestore, ChevronRight, Clock, Ellipsis, MapPinOff, Phone, Plus, UserX } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { toast } from "sonner";
import { InlineAlert } from "@/components/funding-officers/shared";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { OutcomeBadge } from "@/components/status/outcome-badge";
import { StageBadge } from "@/components/status/stage-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiRequest } from "@/lib/api-client";
import { formatDate, formatNumber, formatPhone, formatWeekdayDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ACTIVITY_STATUS_LABELS, type ActivityView } from "@/lib/validation";
import { ArchiveDialog } from "./archive-dialog";
import {
  type ActivityPage,
  type ActivitySummary,
  activityQuery,
  appendActivityPage,
  archiveBlocked,
  canStartPipeline,
  closedPipelines,
  coordinateLine,
  firstActivityPage,
  type PipelineSummary,
  runningPipeline,
  telHref,
} from "./detail-state";
import type { ProspectRecord } from "./form-state";
import { StartPipelineDialog } from "./start-pipeline-dialog";
import {
  activityPath,
  categoryLabel,
  editLocationPath,
  editProspectPath,
  newActivityPath,
  pipelinePath,
  PROSPECT_DETAIL_COPY as COPY,
  PROSPECTS_PATH,
  SCREEN_PATH,
} from "./shared";

// Leaflet needs `window`: the mini map loads on the client only, with a placeholder of the same size.
const ProspectMiniMap = dynamic(() => import("./prospect-mini-map"), {
  ssr: false,
  loading: () => <Skeleton className="size-full rounded-none" />,
});

const linkButton = "h-11 px-4 text-base lg:h-9 lg:text-sm";

type Loaded =
  | { status: "loading" }
  | { status: "error" }
  | { status: "not-found" }
  | {
      status: "ready";
      prospect: ProspectRecord;
      pipelines: PipelineSummary[];
      /** Scheduled (Overdue included) and finished Activities, each paged by the server (BUG-5). */
      upcoming: ActivityPage;
      history: ActivityPage;
    };

type ActivityBody = { items: ActivitySummary[]; hasMore: boolean };

/** True from 1024 px (the desktop layout). False on the server and before the client has measured. */
function useIsDesktop() {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia("(min-width: 1024px)");
      query.addEventListener("change", notify);
      return () => query.removeEventListener("change", notify);
    },
    () => window.matchMedia("(min-width: 1024px)").matches,
    () => false,
  );
}

/**
 * The Prospect detail (E2-S4, docs/design/E2-S4.md): data, Kontak, the open Pipeline, closed Pipelines and
 * Kegiatan in one place, with Ubah, Arsipkan and Mulai Pipeline. Reads on the client (ADR 0003): the
 * Prospect, its Pipelines and its Activities. An archived Prospect opens read-only with "Pulihkan" (EC40).
 */
export function ProspectDetailScreen({ prospectId }: { prospectId: string }) {
  // Keyed by ID inside the component, so any reuse with another ID (not only a route change, which Next
  // already remounts) starts from the loading state, never from the last Prospect's data and actions (BUG-5).
  return <ProspectDetail key={prospectId} prospectId={prospectId} />;
}

function ProspectDetail({ prospectId }: { prospectId: string }) {
  const router = useRouter();
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  // The latest loaded data, for the "load more" callback (it must not be rebuilt on every page).
  const loadedRef = useRef(loaded);
  useEffect(() => {
    loadedRef.current = loaded;
  }, [loaded]);
  const [loadCount, setLoadCount] = useState(0);
  const loadGeneration = useRef(0);
  const refreshing = useRef(true);
  const [reloading, setReloading] = useState(false);
  const [dialog, setDialog] = useState<"start" | "archive" | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<{ message: string; reload: boolean } | null>(null);
  const desktop = useIsDesktop();

  const toSignIn = useCallback(() => {
    router.replace(`/masuk?${new URLSearchParams({ next: `/prospect/${prospectId}` })}`);
  }, [router, prospectId]);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    Promise.all([
      apiRequest<ProspectRecord>(`${PROSPECTS_PATH}/${prospectId}`, { signal }),
      apiRequest<{ items: PipelineSummary[] }>(`/api/pipelines?${new URLSearchParams({ prospectId })}`, { signal }),
      apiRequest<ActivityBody>(`/api/activities?${activityQuery(prospectId, "upcoming")}`, { signal }),
      apiRequest<ActivityBody>(`/api/activities?${activityQuery(prospectId, "history")}`, { signal }),
    ])
      .then(([prospect, pipelines, upcoming, history]) => {
        if (signal.aborted) return;
        refreshing.current = false;
        setReloading(false);
        if ([prospect, pipelines, upcoming, history].some((result) => result.status === 401)) return toSignIn();
        if (!prospect.ok && prospect.status === 404) return setLoaded({ status: "not-found" });
        if (!prospect.ok || !pipelines.ok || !upcoming.ok || !history.ok) return setLoaded({ status: "error" });
        setLoaded({
          status: "ready",
          prospect: prospect.data,
          pipelines: pipelines.data.items,
          upcoming: firstActivityPage(upcoming.data),
          history: firstActivityPage(history.data),
        });
      })
      .catch(() => {
        // Aborted on unmount or when a reload starts.
      });
    return () => controller.abort();
  }, [prospectId, loadCount, toSignIn]);

  /** Fetch again and keep what is on screen until the new data arrives. Ignore older page requests. */
  const refresh = useCallback(() => {
    loadGeneration.current += 1;
    refreshing.current = true;
    setReloading(true);
    setLoadCount((count) => count + 1);
  }, []);

  /** "Muat lebih banyak": the next page of one list. Resolves false when it failed, so the list can say so. */
  const loadMore = useCallback(
    async (view: ActivityView): Promise<boolean> => {
      const current = loadedRef.current;
      if (current.status !== "ready" || refreshing.current) return true;
      const list = current[view];
      if (!list.cursor) return true;
      const generation = loadGeneration.current;
      const result = await apiRequest<ActivityBody>(`/api/activities?${activityQuery(prospectId, view, list.cursor)}`);
      if (generation !== loadGeneration.current) return true;
      if (result.status === 401) {
        toSignIn();
        return true;
      }
      if (!result.ok) return false;
      setLoaded((latest) =>
        latest.status === "ready" ? { ...latest, [view]: appendActivityPage(latest[view], result.data) } : latest,
      );
      return true;
    },
    [prospectId, toSignIn],
  );

  async function restore(prospect: ProspectRecord) {
    if (restoring) return;
    setRestoring(true);
    setRestoreError(null);
    const result = await apiRequest(`${PROSPECTS_PATH}/${prospect.id}/restore`, {
      method: "POST",
      body: { version: prospect.version },
    });
    setRestoring(false);
    if (result.ok) {
      toast.success(COPY.restoredToast);
      return refresh();
    }
    if (result.status === 401) return toSignIn();
    setRestoreError({
      message: result.status === 0 ? COPY.actionFailed : result.error.message,
      reload: result.status === 409,
    });
  }

  const ready = loaded.status === "ready" ? loaded : null;
  const prospect = ready?.prospect;
  const pipelines = ready?.pipelines ?? [];
  const canArchive = prospect && !prospect.archived;
  const blocked = archiveBlocked(pipelines);

  let body: ReactNode;
  if (loaded.status === "loading") {
    body = <DetailSkeleton />;
  } else if (loaded.status === "error") {
    body = (
      <div role="alert" className="flex max-w-160 flex-col items-start gap-3">
        <p className="text-base">{COPY.loadError}</p>
        <Button
          variant="outline"
          onClick={() => {
            setLoaded({ status: "loading" });
            refresh();
          }}
          className={linkButton}
        >
          {COPY.retry}
        </Button>
      </div>
    );
  } else if (loaded.status === "not-found") {
    body = (
      <div className="flex max-w-160 flex-col items-start gap-3">
        <p className="text-base">{COPY.notFound}</p>
        <Link href={SCREEN_PATH} className={cn(buttonVariants({ variant: "outline" }), linkButton)}>
          {COPY.backToList}
        </Link>
      </div>
    );
  } else if (prospect) {
    body = (
      <>
        {prospect.archived && (
          <ArchivedBanner
            prospect={prospect}
            restoring={restoring}
            error={restoreError}
            onRestore={() => restore(prospect)}
            onReload={refresh}
          />
        )}
        <Identity prospect={prospect} pipelines={pipelines} />
        <Sections
          prospect={prospect}
          pipelines={pipelines}
          upcoming={ready!.upcoming}
          history={ready!.history}
          onLoadMore={loadMore}
          reloading={reloading}
          desktop={desktop}
          onStart={() => setDialog("start")}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={
          <>
            <span className="lg:hidden">{COPY.title}</span>
            <span className="hidden [overflow-wrap:anywhere] lg:inline">{prospect?.name ?? COPY.title}</span>
          </>
        }
        backHref={SCREEN_PATH}
        action={
          canArchive && (
            <div className="flex flex-col items-end gap-1.5">
              <div className="flex items-center gap-2">
                <Link href={editProspectPath(prospect.id)} className={cn(buttonVariants({ variant: "outline" }), "h-9 px-3 text-sm")}>
                  {COPY.edit}
                </Link>
                <ArchiveButton blocked={blocked} onClick={() => setDialog("archive")} />
              </div>
              {blocked && <p id={blockedId} className="max-w-64 text-right text-sm text-muted-foreground">{COPY.archiveBlocked}</p>}
            </div>
          )
        }
        mobileAction={
          canArchive && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="ghost" size="icon" aria-label={COPY.actions} className="size-11" />}
              >
                <Ellipsis aria-hidden className="size-5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-auto min-w-48">
                <DropdownMenuItem render={<Link href={editProspectPath(prospect.id)} />} className="min-h-11 px-3 text-base">
                  {COPY.edit}
                </DropdownMenuItem>
                {blocked ? (
                  <DropdownMenuItem disabled aria-describedby={blockedMenuId} className="min-h-11 flex-col items-start justify-center px-3 text-base">
                    {COPY.archive}
                    <span id={blockedMenuId} className="text-sm">
                      {COPY.archiveBlocked}
                    </span>
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={() => setDialog("archive")} className="min-h-11 px-3 text-base">
                    {COPY.archive}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )
        }
      />
      <PageBody>{body}</PageBody>

      {prospect && !prospect.archived && (
        <>
          <StartPipelineDialog
            open={dialog === "start"}
            prospectId={prospect.id}
            onClose={() => setDialog(null)}
            onUnauthorized={toSignIn}
            onStarted={(started) => {
              refresh();
              if (started) {
                setDialog(null);
                toast.success(COPY.startedToast);
              }
            }}
          />
          <ArchiveDialog
            open={dialog === "archive"}
            prospectId={prospect.id}
            name={prospect.name}
            version={prospect.version}
            onClose={() => setDialog(null)}
            onUnauthorized={toSignIn}
            onReload={refresh}
            onArchived={() => {
              setDialog(null);
              toast.success(COPY.archivedToast);
              refresh();
            }}
          />
        </>
      )}
    </>
  );
}

const blockedId = "arsipkan-alasan";
const blockedMenuId = "arsipkan-alasan-menu";

/** Desktop "Arsipkan". Blocked by an open Pipeline (EC19): aria-disabled, so focus can still reach its reason. */
function ArchiveButton({ blocked, onClick }: { blocked: boolean; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="outline"
      aria-disabled={blocked || undefined}
      aria-describedby={blocked ? blockedId : undefined}
      onClick={blocked ? undefined : onClick}
      className={cn("h-9 px-3 text-sm", blocked && "opacity-50")}
    >
      {COPY.archive}
    </Button>
  );
}

function ArchivedBanner({
  prospect,
  restoring,
  error,
  onRestore,
  onReload,
}: {
  prospect: ProspectRecord;
  restoring: boolean;
  error: { message: string; reload: boolean } | null;
  onRestore: () => void;
  onReload: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-base">{COPY.archivedOn(prospect.archivedAt ? formatDate(prospect.archivedAt) : "—")}</p>
        <Button
          type="button"
          variant="outline"
          onClick={onRestore}
          disabled={restoring}
          className={cn(linkButton, "shrink-0 gap-2 disabled:cursor-progress")}
        >
          <ArchiveRestore aria-hidden />
          {COPY.restore}
        </Button>
      </div>
      {error && (
        <InlineAlert
          message={error.message}
          action={
            error.reload && (
              <Button type="button" variant="outline" onClick={onReload} className={linkButton}>
                {COPY.reload}
              </Button>
            )
          }
        />
      )}
    </div>
  );
}

/** Name (mobile; the header has it from 1024 px), Kategori and Funding Officer, labels and the Stage. */
function Identity({ prospect, pipelines }: { prospect: ProspectRecord; pipelines: PipelineSummary[] }) {
  const running = runningPipeline(pipelines);
  const officer = prospect.fundingOfficer;
  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-xl font-semibold [overflow-wrap:anywhere] lg:hidden">{prospect.name}</h2>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-base lg:text-sm">
        <p>{[categoryLabel(prospect.category), officer.name].filter(Boolean).join(", ")}</p>
        {!officer.active && (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <UserX aria-hidden className="size-4" />
            {COPY.inactiveOfficer}
          </span>
        )}
        {prospect.archived && (
          <span className="inline-flex items-center rounded-lg bg-muted px-2 py-0.5 text-sm font-medium text-muted-foreground">
            {COPY.archived}
          </span>
        )}
        {running && (
          <span className="hidden lg:inline-flex">
            <RunningBadge pipeline={running} />
          </span>
        )}
      </div>
    </div>
  );
}

function RunningBadge({ pipeline }: { pipeline: PipelineSummary }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <StageBadge stageName={pipeline.currentStage.name} position={pipeline.currentStage.position} stageCount={pipeline.stageCount} />
      {pipeline.outcome && <OutcomeBadge outcome={pipeline.outcome} />}
    </span>
  );
}

function Sections({
  prospect,
  pipelines,
  upcoming,
  history,
  desktop,
  onStart,
  onLoadMore,
  reloading,
}: {
  prospect: ProspectRecord;
  pipelines: PipelineSummary[];
  upcoming: ActivityPage;
  history: ActivityPage;
  desktop: boolean;
  onStart: () => void;
  onLoadMore: (view: ActivityView) => Promise<boolean>;
  reloading: boolean;
}) {
  const noActivities = upcoming.items.length === 0 && history.items.length === 0;
  const closed = closedPipelines(pipelines);
  const editable = !prospect.archived;

  const pipelineSection = (
    <RunningPipeline
      pipeline={runningPipeline(pipelines)}
      canStart={canStartPipeline(prospect, pipelines)}
      onStart={onStart}
    />
  );
  const contact = <ContactSection contact={prospect.contact} />;
  const data = <DataSection prospect={prospect} editable={editable} />;
  const addActivity = editable ? (
    <Link href={newActivityPath(prospect.id)} className={cn(buttonVariants({ variant: "outline" }), linkButton, "gap-2")}>
      <Plus aria-hidden />
      {COPY.addActivity}
    </Link>
  ) : null;

  if (desktop) {
    return (
      <div className="grid grid-cols-3 items-start gap-6">
        <div className="col-span-2 flex flex-col gap-6">
          {pipelineSection}
          <Section title={COPY.activities} action={addActivity}>
            <Tabs defaultValue="mendatang">
              <TabsList variant="line">
                <TabsTrigger value="mendatang" className="px-3">
                  {COPY.upcoming}
                </TabsTrigger>
                <TabsTrigger value="lalu" className="px-3">
                  {COPY.past}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="mendatang" className="pt-2 text-base lg:text-sm">
                <ActivityList page={upcoming} empty={noActivities ? COPY.noActivities : COPY.noUpcoming} reloading={reloading} onLoadMore={() => onLoadMore("upcoming")} />
              </TabsContent>
              <TabsContent value="lalu" className="pt-2 text-base lg:text-sm">
                <ActivityList page={history} empty={COPY.noPast} reloading={reloading} onLoadMore={() => onLoadMore("history")} />
              </TabsContent>
            </Tabs>
          </Section>
          <Section title={COPY.closedPipelines}>
            <ClosedPipelines items={closed} />
          </Section>
        </div>
        <div className="flex flex-col gap-6">
          {contact}
          {data}
        </div>
      </div>
    );
  }

  return (
    <div className="flex max-w-180 flex-col gap-6">
      {pipelineSection}
      {contact}
      <Section title={COPY.upcoming}>
        <ActivityList page={upcoming} empty={noActivities ? COPY.noActivities : COPY.noUpcoming} reloading={reloading} onLoadMore={() => onLoadMore("upcoming")} />
        {addActivity}
      </Section>
      {data}
      <Section title={COPY.history}>
        <div className="flex flex-col gap-1">
          <h3 className="text-base font-medium">{COPY.closedPipelines}</h3>
          <ClosedPipelines items={closed} />
        </div>
        <div className="flex flex-col gap-1">
          <h3 className="text-base font-medium">{COPY.past}</h3>
          <ActivityList page={history} empty={COPY.noPast} reloading={reloading} onLoadMore={() => onLoadMore("history")} />
        </div>
      </Section>
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="text-xl font-semibold">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** The one Card on the page (DESIGN.md: it is the focal item): the open Pipeline, or "Mulai Pipeline". */
function RunningPipeline({
  pipeline,
  canStart,
  onStart,
}: {
  pipeline: PipelineSummary | null;
  canStart: boolean;
  onStart: () => void;
}) {
  const id = useId();
  const total = pipeline?.tasksTotal ?? 0;
  const done = pipeline?.tasksDone ?? 0;
  return (
    <section aria-labelledby={id}>
      <Card>
        <CardContent className="flex flex-col gap-3">
          <h2 id={id} className="text-xl font-semibold">
            {COPY.openPipeline}
          </h2>
          {pipeline ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <RunningBadge pipeline={pipeline} />
                <p className="text-sm text-muted-foreground">{pipeline.template.name}</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <p className="text-sm tabular-nums">{COPY.tasks(formatNumber(done), formatNumber(total))}</p>
                <Progress
                  value={total === 0 ? 0 : Math.round((done / total) * 100)}
                  aria-label={COPY.tasks(formatNumber(done), formatNumber(total))}
                  className="gap-0 [&_[data-slot=progress-track]]:h-1.5"
                />
              </div>
              <Link href={pipelinePath(pipeline.id)} className={cn(buttonVariants(), linkButton, "w-full justify-between sm:w-fit sm:justify-center sm:gap-2")}>
                {COPY.openPipelineLink}
                <ChevronRight aria-hidden />
              </Link>
            </>
          ) : (
            <>
              <p className="text-base">{COPY.noOpenPipeline}</p>
              {canStart && (
                <Button type="button" onClick={onStart} className={cn(linkButton, "w-full sm:w-fit")}>
                  {COPY.startPipeline}
                </Button>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function ContactSection({ contact }: { contact: ProspectRecord["contact"] }) {
  const phone = contact.phone ? formatPhone(contact.phone) : null;
  const person = [contact.name, contact.role].filter(Boolean).join(", ");
  return (
    <Section title={COPY.contact}>
      {!person && !phone ? (
        <p className="text-base text-muted-foreground lg:text-sm">{COPY.noContact}</p>
      ) : (
        <div className="flex flex-col items-start gap-2">
          {person && <p className="text-base [overflow-wrap:anywhere] lg:text-sm">{person}</p>}
          {contact.phone && phone && (
            <a
              href={telHref(contact.phone)}
              aria-label={COPY.call(contact.name, phone)}
              className={cn(buttonVariants({ variant: "outline" }), linkButton, "gap-2 tabular-nums")}
            >
              <Phone aria-hidden />
              {phone}
            </a>
          )}
        </div>
      )}
    </Section>
  );
}

function DataSection({ prospect, editable }: { prospect: ProspectRecord; editable: boolean }) {
  const empty = <span className="text-muted-foreground">{COPY.empty}</span>;
  return (
    <Section title={COPY.data}>
      <dl className="flex flex-col gap-3 text-base lg:text-sm">
        <Row label={COPY.category}>{categoryLabel(prospect.category) ?? empty}</Row>
        <Row label={COPY.address}>{prospect.address ?? empty}</Row>
        <Row label={COPY.potential}>
          {prospect.potentialAccounts === null ? empty : <span className="tabular-nums">{COPY.accounts(formatNumber(prospect.potentialAccounts))}</span>}
        </Row>
        <Row label={COPY.note}>{prospect.note ? <span className="whitespace-pre-line">{prospect.note}</span> : empty}</Row>
        <Row label={COPY.location}>
          {prospect.location ? (
            <div className="flex flex-col gap-1.5">
              <div
                role="img"
                aria-label={COPY.mapLabel}
                data-testid="mini-map"
                className="h-48 overflow-hidden rounded-lg border border-border lg:h-50"
              >
                {/* Keyed by position: MapContainer reads its centre only once, so a moved location remounts the map. */}
                <ProspectMiniMap
                  key={`${prospect.location.lat},${prospect.location.lng}`}
                  lat={prospect.location.lat}
                  lng={prospect.location.lng}
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-x-3 text-sm text-muted-foreground">
                <p className="tabular-nums">{coordinateLine(prospect.location)}</p>
                {/* The tile credit (OpenStreetMap licence), kept out of the map so it is a real, focusable link. */}
                <a
                  href="https://www.openstreetmap.org/copyright"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`© ${COPY.osmAttribution}. ${COPY.osmLink}`}
                  data-testid="osm-attribution"
                  className="-my-1 inline-flex min-h-11 items-center px-1 text-primary underline underline-offset-4 lg:min-h-0"
                >
                  © {COPY.osmAttribution}
                </a>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <MapPinOff aria-hidden className="size-4" />
                {COPY.noLocation}
              </span>
              {editable && (
                <Link href={editLocationPath(prospect.id)} className="inline-flex min-h-11 items-center text-primary underline underline-offset-4 lg:min-h-0">
                  {COPY.addLocation}
                </Link>
              )}
            </div>
          )}
        </Row>
      </dl>
    </Section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="[overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

const rowLink = "flex min-h-11 flex-col gap-0.5 rounded-lg py-2 hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring lg:min-h-0";

function ActivityList({
  page,
  empty,
  reloading,
  onLoadMore,
}: {
  page: ActivityPage;
  empty: string;
  /** The whole detail is reloading, so the next page waits for it. */
  reloading: boolean;
  /** Loads the next page; resolves false when the request failed. */
  onLoadMore: () => Promise<boolean>;
}) {
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const items = page.items;

  async function more() {
    if (loading) return;
    setLoading(true);
    setFailed(false);
    const ok = await onLoadMore();
    setLoading(false);
    setFailed(!ok);
  }

  if (items.length === 0) return <p className="text-base text-muted-foreground lg:text-sm">{empty}</p>;
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col divide-y divide-border">
        {items.map((item) => (
          <li key={item.id}>
            <Link href={activityPath(item.id)} className={rowLink}>
              <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm tabular-nums text-muted-foreground">
                {formatWeekdayDateTime(item.startsAt)}
                {item.overdue && (
                  <span className="inline-flex items-center gap-1 font-medium text-warning">
                    <Clock aria-hidden className="size-4" />
                    {COPY.overdue}
                  </span>
                )}
                {item.status !== "scheduled" && <span className="font-medium">{ACTIVITY_STATUS_LABELS[item.status]}</span>}
              </span>
              <span className="text-base [overflow-wrap:anywhere] lg:text-sm">{item.purpose}</span>
              <span className="text-sm text-muted-foreground">{item.fundingOfficer.name}</span>
            </Link>
          </li>
        ))}
      </ul>
      {failed && <InlineAlert message={COPY.loadMoreFailed} />}
      {page.hasMore && (
        <Button type="button" variant="outline" onClick={more} disabled={loading || reloading} className={cn(linkButton, "w-full disabled:cursor-progress sm:w-fit")}>
          {loading ? COPY.loadingMore : COPY.loadMore}
        </Button>
      )}
    </div>
  );
}

function ClosedPipelines({ items }: { items: PipelineSummary[] }) {
  if (items.length === 0) return <p className="text-base text-muted-foreground lg:text-sm">{COPY.noClosedPipelines}</p>;
  return (
    <ul className="flex flex-col divide-y divide-border">
      {items.map((item) => (
        <li key={item.id}>
          <Link href={pipelinePath(item.id)} className={rowLink}>
            <span className="flex flex-wrap items-center gap-2">
              {item.outcome && <OutcomeBadge outcome={item.outcome} />}
              <span className="text-base [overflow-wrap:anywhere] lg:text-sm">{item.template.name}</span>
            </span>
            <span className="text-sm tabular-nums text-muted-foreground">
              {COPY.pipelineDates(formatDate(item.startedAt), item.closedAt ? formatDate(item.closedAt) : "—")}
              {item.outcome === "won" && item.accountsOpened !== null && `, ${COPY.accountsOpened(formatNumber(item.accountsOpened))}`}
            </span>
            {item.outcome === "lost" && item.lostReason && (
              <span className="text-sm [overflow-wrap:anywhere] text-muted-foreground">{item.lostReason}</span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Loading: the sections' shape, no spinner. */
function DetailSkeleton() {
  return (
    <div aria-busy className="flex max-w-180 flex-col gap-6 lg:max-w-none lg:grid lg:grid-cols-3 lg:items-start">
      <span className="sr-only">{COPY.loading}</span>
      <div aria-hidden className="flex flex-col gap-6 lg:col-span-2">
        <Skeleton className="h-7 w-2/3 lg:hidden" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-32 w-full" />
      </div>
      <div aria-hidden className="flex flex-col gap-6">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    </div>
  );
}
