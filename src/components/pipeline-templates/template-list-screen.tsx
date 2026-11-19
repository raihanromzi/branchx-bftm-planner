"use client";

import { Archive, ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiRequest } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { PipelineTemplateListItem } from "./editor-state";
import { NEW_TEMPLATE_PATH, PIPELINE_TEMPLATES_PATH, SCREEN_PATH, TEMPLATE_COPY as COPY, templatePath } from "./shared";

type ListState = { status: "loading" } | { status: "error" } | { status: "ready"; items: PipelineTemplateListItem[] };

/**
 * Pengaturan → Template Pipeline (E3-S2, docs/design/E3-S2.md). The list is read on the client from
 * GET /api/pipeline-templates (ADR 0003). Below 1024 px: rows with a floating "Tambah"; from 1024 px: a table
 * with "Tambah Template" in the header. Each row opens the editor.
 */
export function TemplateListScreen() {
  const router = useRouter();
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [loadCount, setLoadCount] = useState(0);

  const toSignIn = useCallback(() => {
    router.replace(`/masuk?${new URLSearchParams({ next: SCREEN_PATH })}`);
  }, [router]);

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<{ items: PipelineTemplateListItem[] }>(PIPELINE_TEMPLATES_PATH, { signal: controller.signal })
      .then((result) => {
        if (result.ok) return setList({ status: "ready", items: result.data.items });
        if (result.status === 401) return toSignIn();
        setList({ status: "error" });
      })
      .catch(() => {
        // Aborted on unmount or when "Coba lagi" starts a new load.
      });
    return () => controller.abort();
  }, [loadCount, toSignIn]);

  const hasItems = list.status === "ready" && list.items.length > 0;

  return (
    <>
      <PageHeader
        title={COPY.title}
        action={
          hasItems && (
            <Link href={NEW_TEMPLATE_PATH} className={cn(buttonVariants(), "h-9 px-3 text-sm")}>
              <Plus aria-hidden />
              {COPY.add}
            </Link>
          )
        }
      />
      <PageBody>
        {list.status === "loading" && <ListSkeleton />}

        {list.status === "error" && (
          <div role="alert" className="flex max-w-160 flex-col items-start gap-3">
            <p className="text-base">{COPY.listLoadError}</p>
            <Button
              variant="outline"
              onClick={() => {
                setList({ status: "loading" });
                setLoadCount((count) => count + 1);
              }}
              className="h-11 px-4 text-base lg:h-9 lg:text-sm"
            >
              {COPY.retry}
            </Button>
          </div>
        )}

        {list.status === "ready" && list.items.length === 0 && (
          <div className="flex max-w-prose flex-col items-start gap-4">
            <p className="text-base text-muted-foreground">{COPY.empty}</p>
            <Link href={NEW_TEMPLATE_PATH} className={cn(buttonVariants(), "h-11 px-4 text-base lg:h-9 lg:text-sm")}>
              <Plus aria-hidden />
              {COPY.add}
            </Link>
          </div>
        )}

        {hasItems && (
          <>
            <TemplateRows items={list.items} />
            {/* Room for the floating "Tambah" button, so the last row stays reachable. */}
            <div aria-hidden className="h-16 lg:hidden" />
            <TemplateTable items={list.items} />
          </>
        )}
      </PageBody>

      {hasItems && (
        <Link
          href={NEW_TEMPLATE_PATH}
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

function ArchivedBadge() {
  return (
    <Badge variant="outline" className="text-muted-foreground">
      <Archive aria-hidden />
      {COPY.archived}
    </Badge>
  );
}

/** Below 1024 px: one row per template, the whole row opens the editor. */
function TemplateRows({ items }: { items: PipelineTemplateListItem[] }) {
  return (
    <ul aria-label={COPY.listLabel} className="max-w-160 border-t border-border lg:hidden">
      {items.map((item) => (
        <li key={item.id} className="border-b border-border">
          <Link
            href={templatePath(item.id)}
            className="-mx-2 flex min-h-16 items-center gap-2 rounded-lg px-2 py-2 hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-base leading-6 font-medium break-words">{item.name}</span>
              <span className="text-sm text-muted-foreground tabular-nums">
                {COPY.stageCount(item.stageCount)} · {COPY.pipelineCount(item.pipelineCount)}
              </span>
            </span>
            {item.archived && <ArchivedBadge />}
            <ChevronRight aria-hidden className="size-5 shrink-0 text-muted-foreground" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** From 1024 px: a compact table; the name links to the editor. */
function TemplateTable({ items }: { items: PipelineTemplateListItem[] }) {
  return (
    <div className="hidden rounded-lg border border-border lg:block">
      <Table>
        <TableHeader className="bg-muted">
          <TableRow className="hover:bg-transparent">
            <TableHead className="px-3">{COPY.name}</TableHead>
            <TableHead className="w-32 px-3">{COPY.stages}</TableHead>
            <TableHead className="w-48 px-3">{COPY.pipelines}</TableHead>
            <TableHead className="w-36 px-3">{COPY.status}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id}>
              <TableCell className="px-3 py-2 font-medium break-words whitespace-normal">
                <Link href={templatePath(item.id)} className="text-primary underline-offset-4 hover:underline">
                  {item.name}
                </Link>
              </TableCell>
              <TableCell className="px-3 py-2 tabular-nums">{COPY.stageCount(item.stageCount)}</TableCell>
              <TableCell className="px-3 py-2 tabular-nums">{COPY.pipelineCount(item.pipelineCount)}</TableCell>
              <TableCell className="px-3 py-2">
                {item.archived ? <ArchivedBadge /> : <span className="text-muted-foreground">{COPY.active}</span>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div role="status" data-testid="template-skeleton" className="flex max-w-160 flex-col lg:max-w-none">
      {Array.from({ length: 4 }, (_, index) => (
        <div aria-hidden key={index} className="flex min-h-16 items-center gap-4 border-b border-border py-2 lg:min-h-11">
          <div className="flex flex-1 flex-col gap-2 lg:flex-row lg:items-center lg:gap-6">
            <Skeleton className="h-5 w-48 rounded-lg" />
            <Skeleton className="h-4 w-40 rounded-lg" />
          </div>
        </div>
      ))}
      <span className="sr-only">{COPY.loadingList}</span>
    </div>
  );
}
