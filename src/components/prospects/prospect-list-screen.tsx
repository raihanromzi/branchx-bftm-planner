"use client";

import { Check, ChevronDown, ChevronLeft, ChevronRight, MapPinOff, Plus, Search, UserX } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { StageBadge } from "@/components/status/stage-badge";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { apiRequest } from "@/lib/api-client";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PROSPECT_CATEGORIES, PROSPECT_CATEGORY_LABELS, PROSPECT_NAME_MAX, type ProspectCategory } from "@/lib/validation";
import {
  DEFAULT_LIST_PARAMS,
  hasFilters,
  pageCount,
  parseListParams,
  type ProspectListParams,
  toApiSearch,
  toScreenSearch,
} from "./list-params";
import {
  categoryLabel,
  type FundingOfficerOption,
  NEW_PROSPECT_PATH,
  PROSPECT_COPY as COPY,
  type ProspectPage,
  type ProspectRow,
  PROSPECTS_PATH,
  prospectPath,
  SCREEN_PATH,
} from "./shared";

/** Search waits this long after the last keystroke (EC6). */
const SEARCH_DEBOUNCE_MS = 300;

type Loaded = { key: string } & ({ status: "error" } | { status: "ready"; data: ProspectPage });

/**
 * The Prospect list (E2-S2, docs/design/E2-S2.md). Search, filters and page live in the URL
 * (`?q=&kategori=&fo=&arsip=1&hal=2`), so a reload keeps them; the list is read on the client from
 * GET /api/prospects (ADR 0003, client-side reads). Below 1024 px: rows with a floating "Tambah";
 * from 1024 px: a table with the count and "Tambah Prospect" in the header.
 */
export function ProspectListScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = useMemo(() => parseListParams(searchParams), [searchParams]);

  // The search field: what the Admin types, written to the URL 300 ms after the last keystroke.
  const [query, setQuery] = useState(params.q);
  // When the URL's search changes from elsewhere (back, "Hapus filter"), show it in the field. A change
  // that only trims what is being typed (a trailing space) leaves the field alone.
  const [syncedQ, setSyncedQ] = useState(params.q);
  if (params.q !== syncedQ) {
    setSyncedQ(params.q);
    if (params.q !== query.trim()) setQuery(params.q);
  }

  const paramsRef = useRef(params);
  useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  /** Writes the list state to the URL. Next.js syncs useSearchParams with the History API. */
  const navigate = useCallback((next: ProspectListParams, mode: "push" | "replace") => {
    const url = `${SCREEN_PATH}${toScreenSearch(next)}`;
    if (mode === "push") window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed === params.q.trim()) return;
    const timer = setTimeout(() => {
      navigate({ ...paramsRef.current, q: trimmed, page: 1 }, "replace");
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, params.q, navigate]);

  const toSignIn = useCallback(() => {
    const next = `${SCREEN_PATH}${toScreenSearch(paramsRef.current)}`;
    router.replace(`/masuk?${new URLSearchParams({ next })}`);
  }, [router]);

  // The list. A result is kept with the request it answers; any other request shows the loading state.
  const [reloadCount, setReloadCount] = useState(0);
  const apiSearch = toApiSearch(params);
  const requestKey = `${apiSearch}#${reloadCount}`;
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<ProspectPage>(`${PROSPECTS_PATH}${apiSearch}`, { signal: controller.signal })
      .then((result) => {
        if (result.ok) return setLoaded({ key: requestKey, status: "ready", data: result.data });
        if (result.status === 401) return toSignIn();
        setLoaded({ key: requestKey, status: "error" });
      })
      .catch(() => {
        // Aborted: a newer request replaced this one.
      });
    return () => controller.abort();
  }, [apiSearch, requestKey, toSignIn]);

  const current = loaded?.key === requestKey ? loaded : null;
  const data = current?.status === "ready" ? current.data : null;
  const pages = data ? pageCount(data.total, data.pageSize) : 1;

  // A page past the end (an old link, or fewer Prospects since): go to the last page.
  useEffect(() => {
    if (data && data.items.length === 0 && data.total > 0 && params.page > pages) {
      navigate({ ...params, page: pages }, "replace");
    }
  }, [data, params, pages, navigate]);

  // The Funding Officer filter's options.
  const [officers, setOfficers] = useState<FundingOfficerOption[] | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    apiRequest<{ items: FundingOfficerOption[] }>("/api/funding-officers", { signal: controller.signal })
      .then((result) => {
        if (result.ok) setOfficers(result.data.items);
        else if (result.status === 401) toSignIn();
      })
      .catch(() => {
        // Aborted on unmount.
      });
    return () => controller.abort();
  }, [toSignIn]);

  /** A filter change: keeps what is typed in the search, and goes back to page 1. */
  function setFilter(change: Partial<ProspectListParams>) {
    navigate({ ...params, q: query.trim(), ...change, page: 1 }, "push");
  }

  function goToPage(page: number) {
    navigate({ ...params, page }, "push");
    window.scrollTo({ top: 0 });
  }

  function clearFilters() {
    setQuery("");
    navigate({ ...DEFAULT_LIST_PARAMS, archived: params.archived }, "push");
  }

  // No count when nothing is listed: the empty and no-results messages say it in words.
  const countText = data && data.total > 0 ? COPY.count(formatNumber(data.total)) : "";
  const hasRows = Boolean(data && data.items.length > 0);
  const isEmpty = Boolean(data && data.total === 0 && !hasFilters(params));
  const noResults = Boolean(data && data.total === 0 && hasFilters(params));

  return (
    <>
      <PageHeader
        title={COPY.title}
        action={
          <div className="flex items-center gap-4">
            <p aria-live="polite" className="text-sm text-muted-foreground tabular-nums">
              {countText}
            </p>
            <Link href={NEW_PROSPECT_PATH} className={cn(buttonVariants(), "h-9 px-3 text-sm")}>
              <Plus aria-hidden />
              {COPY.add}
            </Link>
          </div>
        }
      />
      <PageBody>
        <FilterBar
          query={query}
          onQueryChange={(event) => setQuery(event.target.value)}
          params={params}
          officers={officers}
          onCategory={(category) => setFilter({ category })}
          onFundingOfficer={(fundingOfficerId) => setFilter({ fundingOfficerId })}
          onArchived={(archived) => setFilter({ archived })}
        />

        <p aria-live="polite" className="-mt-1 text-sm text-muted-foreground tabular-nums lg:hidden">
          {countText}
        </p>

        {!current && <ListSkeleton />}

        {current?.status === "error" && (
          <div role="alert" className="flex max-w-160 flex-col items-start gap-3">
            <p className="text-base">{COPY.loadError}</p>
            <Button
              variant="outline"
              onClick={() => setReloadCount((count) => count + 1)}
              className="h-11 px-4 text-base lg:h-9 lg:text-sm"
            >
              {COPY.retry}
            </Button>
          </div>
        )}

        {isEmpty && (
          <div className="flex max-w-prose flex-col items-start gap-4">
            <p className="text-base text-muted-foreground">{COPY.empty}</p>
            <Link href={NEW_PROSPECT_PATH} className={cn(buttonVariants(), "h-11 px-4 text-base lg:h-9 lg:text-sm")}>
              <Plus aria-hidden />
              {COPY.add}
            </Link>
          </div>
        )}

        {noResults && (
          <div className="flex max-w-prose flex-col items-start gap-4">
            <p className="text-base text-muted-foreground break-words">
              {params.q.trim() ? COPY.noResultsFor(params.q.trim()) : COPY.noResults}
            </p>
            <Button variant="outline" onClick={clearFilters} className="h-11 px-4 text-base lg:h-9 lg:text-sm">
              {COPY.clearFilters}
            </Button>
          </div>
        )}

        {data && hasRows && (
          <>
            <ProspectList items={data.items} />
            <ProspectTable items={data.items} />
            {pages > 1 && <Pager page={params.page} pages={pages} onPage={goToPage} />}
            {/* Room for the floating "Tambah" button, so the last row and the pager stay reachable. */}
            <div aria-hidden className="h-16 lg:hidden" />
          </>
        )}
      </PageBody>

      {!isEmpty && (
        <Link
          href={NEW_PROSPECT_PATH}
          aria-label={COPY.add}
          className={cn(
            buttonVariants(),
            "fixed right-4 bottom-[calc(var(--bottom-nav-height)+env(safe-area-inset-bottom)+16px)] z-30 h-14 gap-2 px-5 text-base shadow-md lg:hidden",
          )}
        >
          <Plus aria-hidden className="size-5" />
          {COPY.addShort}
        </Link>
      )}
    </>
  );
}

const chipClass =
  "h-11 shrink-0 rounded-lg border border-input bg-background text-base font-normal text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring lg:h-9 lg:text-sm";
const chipActiveClass = "border-primary bg-accent font-medium text-accent-foreground";

function FilterBar({
  query,
  onQueryChange,
  params,
  officers,
  onCategory,
  onFundingOfficer,
  onArchived,
}: {
  query: string;
  onQueryChange: (event: ChangeEvent<HTMLInputElement>) => void;
  params: ProspectListParams;
  officers: FundingOfficerOption[] | null;
  onCategory: (category: ProspectCategory | null) => void;
  onFundingOfficer: (id: string | null) => void;
  onArchived: (archived: boolean) => void;
}) {
  const selectedMissing =
    params.fundingOfficerId !== null && !officers?.some((officer) => officer.id === params.fundingOfficerId);

  return (
    // Below 1024 px the search and filters stay under the top bar while the list scrolls.
    <div className="sticky top-(--top-bar-height) z-20 -mx-4 -mt-4 flex flex-col gap-3 bg-background px-4 pt-4 pb-1 lg:static lg:mx-0 lg:mt-0 lg:flex-row lg:items-center lg:px-0 lg:pt-0">
      <div className="relative w-full lg:w-80 lg:shrink-0">
        <label htmlFor="prospect-search" className="sr-only">
          {COPY.searchLabel}
        </label>
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground lg:size-4"
        />
        <Input
          id="prospect-search"
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          maxLength={PROSPECT_NAME_MAX}
          placeholder={COPY.searchPlaceholder}
          value={query}
          onChange={onQueryChange}
          className="h-12 pl-10 text-base md:text-base lg:h-9 lg:pl-9 lg:text-sm"
        />
      </div>

      {/* On a phone the chips scroll sideways inside their own box; from 768 px they fit on one line. */}
      <div
        role="group"
        aria-label={COPY.filters}
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pt-0.5 pb-2 md:mx-0 md:overflow-visible md:px-0 lg:pb-0.5"
      >
        <FilterSelect
          label={COPY.category}
          value={params.category ?? ""}
          onChange={(value) => onCategory(value ? (value as ProspectCategory) : null)}
        >
          <option value="">{COPY.allCategories}</option>
          {PROSPECT_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {PROSPECT_CATEGORY_LABELS[category]}
            </option>
          ))}
        </FilterSelect>

        <FilterSelect
          label={COPY.fundingOfficer}
          value={params.fundingOfficerId ?? ""}
          onChange={(value) => onFundingOfficer(value || null)}
        >
          <option value="">{COPY.allFundingOfficers}</option>
          {selectedMissing && <option value={params.fundingOfficerId!}>{COPY.selectedFundingOfficer}</option>}
          {officers?.map((officer) => (
            <option key={officer.id} value={officer.id}>
              {officer.active ? officer.name : `${officer.name}${COPY.inactiveSuffix}`}
            </option>
          ))}
        </FilterSelect>

        <Button
          type="button"
          variant="outline"
          aria-pressed={params.archived}
          onClick={() => onArchived(!params.archived)}
          className={cn(chipClass, "gap-1.5 px-3", params.archived && chipActiveClass)}
        >
          {params.archived && <Check aria-hidden className="size-4" />}
          {COPY.showArchived}
        </Button>
      </div>
    </div>
  );
}

/** A filter chip: a native select (the phone's own picker), labelled by its filter's name. */
function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <div className="relative shrink-0">
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(chipClass, "max-w-64 appearance-none truncate pr-9 pl-3", value && chipActiveClass)}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  );
}

function StageCell({ row }: { row: ProspectRow }) {
  if (!row.openPipeline) return <span className="text-sm text-muted-foreground">{COPY.noPipeline}</span>;
  const { stageName, stagePosition, stageCount } = row.openPipeline;
  return <StageBadge stageName={stageName} position={stagePosition} stageCount={stageCount} />;
}

function ArchivedLabel() {
  return (
    <Badge variant="outline" className="text-muted-foreground">
      {COPY.archived}
    </Badge>
  );
}

/** "Funding Officer nonaktif" (DESIGN.md). In the table's Funding Officer column the first words are left to the column. */
function InactiveOfficer({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-1 text-sm text-muted-foreground">
      <UserX aria-hidden className="size-4 shrink-0" />
      {compact ? (
        <span>
          <span className="sr-only">{COPY.inactiveOfficerPrefix}</span>
          {COPY.inactiveShort}
        </span>
      ) : (
        COPY.inactiveOfficer
      )}
    </span>
  );
}

/** "Belum ada lokasi" (EC34). In the table's Lokasi column the last word is left to the column header. */
function NoLocation({ short = false }: { short?: boolean }) {
  return (
    <span className="flex items-center gap-1 text-sm text-muted-foreground">
      <MapPinOff aria-hidden className="size-4 shrink-0" />
      {short ? (
        <span>
          {COPY.locationNo}
          <span className="sr-only">{COPY.locationNoSuffix}</span>
        </span>
      ) : (
        COPY.noLocation
      )}
    </span>
  );
}

/**
 * Below 1024 px: one row per Prospect, separated by borders. The name is the link; it stretches over
 * the whole row (at least 72 px high), so the row is one tap target and its accessible name is the name.
 */
function ProspectList({ items }: { items: ProspectRow[] }) {
  return (
    <ul aria-label={COPY.list} className="border-t border-border lg:hidden">
      {items.map((row) => {
        const meta = [categoryLabel(row.category), row.fundingOfficer.name].filter(Boolean).join(", ");
        return (
          <li
            key={row.id}
            data-testid="prospect-row"
            className="relative flex min-h-18 flex-col items-start gap-1.5 border-b border-border py-3 has-[a:hover]:bg-muted/50"
          >
            <div className="flex w-full flex-wrap items-center gap-x-2 gap-y-1">
              <Link
                href={prospectPath(row.id)}
                className={cn(
                  "min-w-0 text-base leading-6 font-medium break-words outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring",
                  row.archived && "text-muted-foreground",
                )}
              >
                {row.name}
              </Link>
              {row.archived && <ArchivedLabel />}
            </div>
            <StageCell row={row} />
            <span className="text-sm text-muted-foreground break-words">{meta}</span>
            {!row.fundingOfficer.active && <InactiveOfficer />}
            {!row.hasLocation && <NoLocation />}
          </li>
        );
      })}
    </ul>
  );
}

/** From 1024 px: a compact table. The name truncates to one line, with the full name in a tooltip. */
function ProspectTable({ items }: { items: ProspectRow[] }) {
  return (
    <div className="hidden rounded-lg border border-border lg:block">
      <Table className="table-fixed">
        <TableHeader className="bg-muted">
          <TableRow className="hover:bg-transparent">
            <TableHead className="px-3">{COPY.columns.name}</TableHead>
            <TableHead className="w-60 px-2">{COPY.columns.stage}</TableHead>
            <TableHead className="w-36 px-2">{COPY.columns.fundingOfficer}</TableHead>
            <TableHead className="w-26 px-2">{COPY.columns.category}</TableHead>
            <TableHead className="w-34 px-2 text-right">{COPY.columns.potential}</TableHead>
            <TableHead className="w-30 px-3">{COPY.columns.location}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((row) => (
            <TableRow key={row.id} data-testid="prospect-row" className="h-11">
              <TableCell className="px-3 py-1.5">
                <div className="flex min-w-0 items-center gap-2">
                  <TruncatedLink href={prospectPath(row.id)} muted={row.archived}>
                    {row.name}
                  </TruncatedLink>
                  {row.archived && <ArchivedLabel />}
                </div>
              </TableCell>
              <TableCell className="px-2 py-1.5 whitespace-normal">
                <StageCell row={row} />
              </TableCell>
              <TableCell className="px-2 py-1.5 break-words whitespace-normal">
                {row.fundingOfficer.name}
                {!row.fundingOfficer.active && <InactiveOfficer compact />}
              </TableCell>
              <TableCell className="px-2 py-1.5">
                {categoryLabel(row.category) ?? <Missing label={COPY.noCategory} />}
              </TableCell>
              <TableCell className="px-2 py-1.5 text-right tabular-nums">
                {row.potentialAccounts === null ? (
                  <Missing label={COPY.noPotential} />
                ) : (
                  formatNumber(row.potentialAccounts)
                )}
              </TableCell>
              <TableCell className="py-1.5 px-3">
                {row.hasLocation ? COPY.locationYes : <NoLocation short />}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** An empty cell: a dash on screen, words for a screen reader. */
function Missing({ label }: { label: string }) {
  return (
    <>
      <span aria-hidden className="text-muted-foreground">
        –
      </span>
      <span className="sr-only">{label}</span>
    </>
  );
}

/**
 * The name link in the table (EC7): one line, cut with an ellipsis. When it is cut, hovering or focusing
 * it shows the full name in a tooltip; the link's accessible name is always the full name.
 */
function TruncatedLink({ href, muted, children }: { href: string; muted: boolean; children: string }) {
  const ref = useRef<HTMLAnchorElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <Tooltip
      open={open}
      onOpenChange={(next) => {
        const element = ref.current;
        if (next && element && element.scrollWidth <= element.clientWidth) return;
        setOpen(next);
      }}
    >
      <TooltipTrigger
        delay={300}
        render={
          <Link
            ref={ref}
            href={href}
            className={cn(
              "block min-w-0 truncate font-medium underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              muted && "text-muted-foreground",
            )}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="bottom" align="start" className="max-w-md text-sm break-words">
        {children}
      </TooltipContent>
    </Tooltip>
  );
}

function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (page: number) => void }) {
  const buttonClass = "size-11 px-0 text-base md:w-auto md:px-3 lg:h-9 lg:text-sm";
  return (
    <nav aria-label={COPY.pages} className="flex items-center justify-between gap-3 lg:justify-end">
      <Button
        variant="outline"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
        aria-label={COPY.previous}
        className={buttonClass}
      >
        <ChevronLeft aria-hidden className="size-5 lg:size-4" />
        <span aria-hidden className="hidden md:inline">
          {COPY.previous}
        </span>
      </Button>
      <p className="text-sm tabular-nums">{COPY.pageOf(formatNumber(page), formatNumber(pages))}</p>
      <Button
        variant="outline"
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
        aria-label={COPY.next}
        className={buttonClass}
      >
        <span aria-hidden className="hidden md:inline">
          {COPY.next}
        </span>
        <ChevronRight aria-hidden className="size-5 lg:size-4" />
      </Button>
    </nav>
  );
}

/** Loading: eight rows shaped like the content (rows below 1024 px, table rows from 1024 px). */
function ListSkeleton() {
  return (
    <div role="status" data-testid="prospect-skeleton" className="flex flex-col border-t border-border">
      {Array.from({ length: 8 }, (_, index) => (
        <div
          aria-hidden
          key={index}
          className="flex min-h-18 flex-col justify-center gap-2 border-b border-border py-3 lg:min-h-11 lg:flex-row lg:items-center lg:gap-6 lg:py-2"
        >
          <Skeleton className="h-5 w-56 max-w-full rounded-lg lg:flex-1" />
          <Skeleton className="h-6 w-32 rounded-lg lg:w-44" />
          <Skeleton className="h-4 w-40 rounded-lg lg:w-36" />
          <Skeleton className="hidden h-4 w-20 rounded-lg lg:block" />
          <Skeleton className="hidden h-4 w-16 rounded-lg lg:block" />
        </div>
      ))}
      <span className="sr-only">{COPY.loading}</span>
    </div>
  );
}
