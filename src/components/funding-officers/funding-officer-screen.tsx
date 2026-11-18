"use client";

import { Ellipsis, Plus, UserX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiRequest } from "@/lib/api-client";
import { formatPhone } from "@/lib/format";
import { DeactivateConfirm } from "./deactivate-confirm";
import { FundingOfficerFormDialog } from "./funding-officer-form";
import {
  FO_COPY,
  FUNDING_OFFICERS_PATH,
  type FundingOfficer,
  InlineAlert,
  SCREEN_PATH,
  sortFundingOfficers,
} from "./shared";

type ListState = { status: "loading" } | { status: "error" } | { status: "ready"; items: FundingOfficer[] };
type Notice = { message: string; reload: boolean; id: number };
type ActionError = { message: string; reload: boolean };

/**
 * Pengaturan → Funding Officer (E1-S2, docs/design/E1-S2.md). The list is read on the client from
 * GET /api/funding-officers (ADR 0003, client-side reads), so it can be read again after every change.
 * Below 1024 px: a list with a floating "Tambah" button; from 1024 px: a table with the header action.
 */
export function FundingOfficerScreen() {
  const router = useRouter();
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [form, setForm] = useState<{ open: boolean; officer: FundingOfficer | null; session: number }>({
    open: false,
    officer: null,
    session: 0,
  });
  const [confirm, setConfirm] = useState<{ open: boolean; officer: FundingOfficer | null }>({ open: false, officer: null });
  const [confirmPending, setConfirmPending] = useState(false);
  const [confirmError, setConfirmError] = useState<ActionError | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const toSignIn = useCallback(() => {
    router.replace(`/masuk?${new URLSearchParams({ next: SCREEN_PATH })}`);
  }, [router]);

  /** Reads the list. Returns the items, or null when it failed (the caller decides what to show). */
  const fetchList = useCallback(
    async (signal?: AbortSignal): Promise<FundingOfficer[] | null> => {
      const result = await apiRequest<{ items: FundingOfficer[] }>(FUNDING_OFFICERS_PATH, { signal });
      if (result.ok) return result.data.items;
      if (result.status === 401) toSignIn();
      return null;
    },
    [toSignIn],
  );

  useEffect(() => {
    const controller = new AbortController();
    fetchList(controller.signal)
      .then((items) => setList(items ? { status: "ready", items } : { status: "error" }))
      .catch(() => {
        // Aborted on unmount.
      });
    return () => controller.abort();
  }, [fetchList]);

  async function retry() {
    setList({ status: "loading" });
    const items = await fetchList();
    setList(items ? { status: "ready", items } : { status: "error" });
  }

  /** Reads the list again in the background; the current list stays on screen meanwhile. */
  async function reloadList(): Promise<FundingOfficer[] | null> {
    const items = await fetchList();
    if (items) setList({ status: "ready", items });
    return items;
  }

  /** Shows a saved record at once, then confirms the list with the server. */
  function applySaved(record: FundingOfficer) {
    setList((current) => {
      const items = current.status === "ready" ? current.items.filter((item) => item.id !== record.id) : [];
      return { status: "ready", items: sortFundingOfficers([...items, record]) };
    });
    void reloadList();
  }

  function showNotice(message: string, reload: boolean) {
    setNotice((previous) => ({ message, reload, id: (previous?.id ?? 0) + 1 }));
  }

  function openForm(officer: FundingOfficer | null) {
    setNotice(null);
    setForm((current) => ({ open: true, officer, session: current.session + 1 }));
  }

  function closeForm() {
    setForm((current) => ({ ...current, open: false }));
  }

  function openConfirm(officer: FundingOfficer) {
    setNotice(null);
    setConfirmError(null);
    setConfirmPending(false);
    setConfirm({ open: true, officer });
  }

  function closeConfirm() {
    setConfirm((current) => ({ ...current, open: false }));
  }

  async function deactivate() {
    const officer = confirm.officer;
    if (!officer || confirmPending) return;
    setConfirmPending(true);
    setConfirmError(null);
    const result = await apiRequest<FundingOfficer>(`${FUNDING_OFFICERS_PATH}/${officer.id}/deactivate`, {
      method: "POST",
      body: { version: officer.version },
    });
    setConfirmPending(false);
    if (result.ok) {
      applySaved(result.data);
      closeConfirm();
      return;
    }
    if (result.status === 401) return toSignIn();
    setConfirmError({ message: result.error.message, reload: result.status === 409 || result.status === 404 });
  }

  async function reactivate(officer: FundingOfficer) {
    if (busyId) return;
    setBusyId(officer.id);
    setNotice(null);
    const result = await apiRequest<FundingOfficer>(`${FUNDING_OFFICERS_PATH}/${officer.id}/reactivate`, {
      method: "POST",
      body: { version: officer.version },
    });
    setBusyId(null);
    if (result.ok) return applySaved(result.data);
    if (result.status === 401) return toSignIn();
    showNotice(result.error.message, result.status === 409 || result.status === 404);
  }

  async function loadLatest(id: string): Promise<FundingOfficer | null> {
    const items = await reloadList();
    return items?.find((item) => item.id === id) ?? null;
  }

  const ready = list.status === "ready";
  const hasItems = ready && list.items.length > 0;
  const actions = { onEdit: openForm, onDeactivate: openConfirm, onReactivate: reactivate, busyId };

  return (
    <>
      <PageHeader
        title={FO_COPY.title}
        action={
          hasItems && (
            <Button onClick={() => openForm(null)} className="h-9 px-3 text-sm">
              <Plus aria-hidden />
              {FO_COPY.add}
            </Button>
          )
        }
      />
      <PageBody>
        {notice && (
          <div className="max-w-160 lg:max-w-none">
            <InlineAlert
              key={notice.id}
              message={notice.message}
              action={
                notice.reload && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={async () => {
                      if (await reloadList()) setNotice(null);
                    }}
                    className="h-11 px-4 text-base lg:h-9 lg:text-sm"
                  >
                    {FO_COPY.reload}
                  </Button>
                )
              }
            />
          </div>
        )}

        {list.status === "loading" && <ListSkeleton />}

        {list.status === "error" && (
          <div role="alert" className="flex max-w-160 flex-col items-start gap-3">
            <p className="text-base">{FO_COPY.loadError}</p>
            <Button variant="outline" onClick={retry} className="h-11 px-4 text-base lg:h-9 lg:text-sm">
              {FO_COPY.retry}
            </Button>
          </div>
        )}

        {ready && list.items.length === 0 && (
          <div className="flex max-w-prose flex-col items-start gap-4">
            <p className="text-base text-muted-foreground">{FO_COPY.empty}</p>
            <Button onClick={() => openForm(null)} className="h-11 px-4 text-base lg:h-9 lg:text-sm">
              <Plus aria-hidden />
              {FO_COPY.add}
            </Button>
          </div>
        )}

        {hasItems && (
          <>
            <OfficerList items={list.items} {...actions} />
            {/* Room for the floating "Tambah" button, so the last row's menu stays reachable. */}
            <div aria-hidden className="h-16 lg:hidden" />
            <OfficerTable items={list.items} {...actions} />
          </>
        )}
      </PageBody>

      {hasItems && (
        <Button
          onClick={() => openForm(null)}
          className="fixed right-4 bottom-[calc(var(--bottom-nav-height)+env(safe-area-inset-bottom)+16px)] z-30 h-14 gap-2 px-5 text-base shadow-md lg:hidden"
        >
          <Plus aria-hidden className="size-5" />
          {FO_COPY.addShort}
        </Button>
      )}

      <FundingOfficerFormDialog
        key={form.session}
        open={form.open}
        officer={form.officer}
        onSaved={(record) => {
          applySaved(record);
          closeForm();
        }}
        onClose={closeForm}
        onUnauthorized={toSignIn}
        loadLatest={loadLatest}
      />

      <DeactivateConfirm
        open={confirm.open}
        officer={confirm.officer}
        pending={confirmPending}
        error={confirmError}
        onConfirm={deactivate}
        onReload={async () => {
          if (await reloadList()) closeConfirm();
        }}
        onClose={closeConfirm}
      />
    </>
  );
}

type ActionProps = {
  onEdit: (officer: FundingOfficer) => void;
  onDeactivate: (officer: FundingOfficer) => void;
  onReactivate: (officer: FundingOfficer) => void;
  busyId: string | null;
};

function InactiveBadge() {
  return (
    <Badge variant="outline" className="text-muted-foreground">
      <UserX aria-hidden />
      {FO_COPY.inactive}
    </Badge>
  );
}

function PhoneLink({ phone, className }: { phone: string; className?: string }) {
  return (
    <a href={`tel:${phone}`} className={className}>
      {formatPhone(phone)}
    </a>
  );
}

/** Below 1024 px: rows (not cards) with the name, phone, status label and a ⋯ menu. */
function OfficerList({ items, onEdit, onDeactivate, onReactivate, busyId }: ActionProps & { items: FundingOfficer[] }) {
  return (
    <ul aria-label="Daftar Funding Officer" className="max-w-160 border-t border-border lg:hidden">
      {items.map((officer) => (
        <li
          key={officer.id}
          className="flex min-h-16 items-center gap-2 border-b border-border py-2"
        >
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-base leading-6 font-medium break-words">{officer.name}</span>
            {/* The link's padding makes a 44 px target without making the row taller. */}
            <PhoneLink
              phone={officer.phone}
              className="-my-3 self-start py-3 text-sm text-muted-foreground tabular-nums underline-offset-4 hover:underline"
            />
          </div>
          {!officer.active && <InactiveBadge />}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={FO_COPY.actionsFor(officer.name)}
                  disabled={busyId === officer.id}
                  className="-mr-2 size-11 shrink-0"
                />
              }
            >
              <Ellipsis aria-hidden className="size-5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-auto min-w-44">
              <DropdownMenuItem onClick={() => onEdit(officer)} className="min-h-11 px-3 text-base">
                {FO_COPY.edit}
              </DropdownMenuItem>
              {officer.active ? (
                <DropdownMenuItem onClick={() => onDeactivate(officer)} className="min-h-11 px-3 text-base">
                  {FO_COPY.deactivate}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={() => onReactivate(officer)} className="min-h-11 px-3 text-base">
                  {FO_COPY.reactivate}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </li>
      ))}
    </ul>
  );
}

/** From 1024 px: a compact table, with the actions written out on each row. */
function OfficerTable({ items, onEdit, onDeactivate, onReactivate, busyId }: ActionProps & { items: FundingOfficer[] }) {
  return (
    <div className="hidden rounded-lg border border-border lg:block">
      <Table>
        <TableHeader className="bg-muted">
          <TableRow className="hover:bg-transparent">
            <TableHead className="px-3">{FO_COPY.name}</TableHead>
            <TableHead className="w-44 px-3">{FO_COPY.phone}</TableHead>
            <TableHead className="w-32 px-3">{FO_COPY.status}</TableHead>
            <TableHead className="w-56 px-3">
              <span className="sr-only">{FO_COPY.actions}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((officer) => (
            <TableRow key={officer.id}>
              <TableCell className="px-3 py-2 font-medium break-words whitespace-normal">{officer.name}</TableCell>
              <TableCell className="px-3 py-2 tabular-nums">
                <PhoneLink phone={officer.phone} className="underline-offset-4 hover:underline" />
              </TableCell>
              <TableCell className="px-3 py-2">
                {officer.active ? <span className="text-muted-foreground">{FO_COPY.active}</span> : <InactiveBadge />}
              </TableCell>
              <TableCell className="px-3 py-1.5 text-right">
                <div className="flex justify-end gap-1">
                  <Button
                    variant="ghost"
                    aria-label={`${FO_COPY.edit} ${officer.name}`}
                    onClick={() => onEdit(officer)}
                    className="h-8 px-2.5 text-primary hover:bg-accent hover:text-primary"
                  >
                    {FO_COPY.edit}
                  </Button>
                  {officer.active ? (
                    <Button
                      variant="ghost"
                      aria-label={`${FO_COPY.deactivate} ${officer.name}`}
                      onClick={() => onDeactivate(officer)}
                      className="h-8 px-2.5 text-primary hover:bg-accent hover:text-primary"
                    >
                      {FO_COPY.deactivate}
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      aria-label={`${FO_COPY.reactivate} ${officer.name}`}
                      onClick={() => onReactivate(officer)}
                      disabled={busyId === officer.id}
                      className="h-8 px-2.5 text-primary hover:bg-accent hover:text-primary"
                    >
                      {FO_COPY.reactivate}
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Loading: five rows shaped like the content (a table on desktop, rows below). */
function ListSkeleton() {
  return (
    <div role="status" data-testid="fo-skeleton" className="flex max-w-160 flex-col lg:max-w-none">
      {Array.from({ length: 5 }, (_, index) => (
        <div aria-hidden key={index} className="flex min-h-16 items-center gap-4 border-b border-border py-2 lg:min-h-11">
          <div className="flex flex-1 flex-col gap-2 lg:flex-row lg:items-center lg:gap-6">
            <Skeleton className="h-5 w-48 rounded-lg" />
            <Skeleton className="h-4 w-32 rounded-lg" />
          </div>
          <Skeleton className="size-8 rounded-lg lg:h-5 lg:w-24" />
        </div>
      ))}
      <span className="sr-only">Memuat daftar Funding Officer…</span>
    </div>
  );
}
