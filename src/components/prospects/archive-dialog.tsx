"use client";

import { useEffect, useState } from "react";
import { InlineAlert } from "@/components/funding-officers/shared";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest } from "@/lib/api-client";
import { formatNumber } from "@/lib/format";
import { PROSPECT_DETAIL_COPY as COPY, PROSPECTS_PATH } from "./shared";

const buttonClass = "h-11 px-4 text-base lg:h-9 lg:text-sm";

/**
 * "Arsipkan SDN 3 Cibinong? 2 Kegiatan mendatang akan dibatalkan." (docs/design/E2-S4.md, EC19). The count
 * comes from GET /api/prospects/:id/archive-preview; the sentence is left out when it is 0. The Arsipkan
 * button waits for the count, so the Admin never confirms blind.
 */
export function ArchiveDialog({
  open,
  prospectId,
  name,
  version,
  onClose,
  onArchived,
  onReload,
  onUnauthorized,
}: {
  open: boolean;
  prospectId: string;
  name: string;
  version: number;
  onClose: () => void;
  onArchived: () => void;
  /** After a refusal that means the page is out of date (409, or an open Pipeline appeared): reload. */
  onReload: () => void;
  onUnauthorized: () => void;
}) {
  return (
    <ResponsiveDialog open={open} onOpenChange={(next) => !next && onClose()}>
      <ResponsiveDialogContent>
        {/* Keyed by version: after a conflict reload the preview is fetched again, not kept from before. */}
        <ArchiveForm
          key={version}
          prospectId={prospectId}
          name={name}
          version={version}
          onArchived={onArchived}
          onReload={onReload}
          onUnauthorized={onUnauthorized}
        />
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

type Preview = { status: "loading" } | { status: "error" } | { status: "ready"; count: number };

function ArchiveForm({
  prospectId,
  name,
  version,
  onArchived,
  onReload,
  onUnauthorized,
}: {
  prospectId: string;
  name: string;
  version: number;
  onArchived: () => void;
  onReload: () => void;
  onUnauthorized: () => void;
}) {
  const [preview, setPreview] = useState<Preview>({ status: "loading" });
  const [loadCount, setLoadCount] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ message: string; reload: boolean } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<{ futureScheduledActivities: number }>(`${PROSPECTS_PATH}/${prospectId}/archive-preview`, {
      signal: controller.signal,
    })
      .then((result) => {
        if (result.status === 401) return onUnauthorized();
        setPreview(result.ok ? { status: "ready", count: result.data.futureScheduledActivities } : { status: "error" });
      })
      .catch(() => {
        // Aborted when the dialog closes.
      });
    return () => controller.abort();
  }, [prospectId, loadCount, onUnauthorized]);

  async function archive() {
    if (pending || preview.status !== "ready") return;
    setPending(true);
    setError(null);
    const result = await apiRequest(`${PROSPECTS_PATH}/${prospectId}/archive`, { method: "POST", body: { version } });
    setPending(false);
    if (result.ok) return onArchived();
    if (result.status === 401) return onUnauthorized();
    // 409 (EC18) and "Pipeline berjalan" (EC19, started in another tab): the page is stale, so offer a reload.
    const stale = result.status === 409 || result.error.code === "prospect_has_open_pipeline";
    setError({ message: result.status === 0 ? COPY.actionFailed : result.error.message, reload: stale });
  }

  return (
    <>
      <ResponsiveDialogTitle>{COPY.archiveQuestion(name)}</ResponsiveDialogTitle>

      {preview.status === "loading" && (
        <div aria-busy>
          <span className="sr-only">{COPY.loading}</span>
          <Skeleton aria-hidden className="h-6 w-3/4" />
        </div>
      )}
      {preview.status === "ready" && preview.count > 0 && (
        <ResponsiveDialogDescription className="text-foreground">
          {COPY.archiveCancels(formatNumber(preview.count))}
        </ResponsiveDialogDescription>
      )}
      {preview.status === "error" && (
        <InlineAlert
          message={COPY.archivePreviewFailed}
          action={
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setPreview({ status: "loading" });
                setLoadCount((count) => count + 1);
              }}
              className={buttonClass}
            >
              {COPY.retry}
            </Button>
          }
        />
      )}

      {error && (
        <InlineAlert
          message={error.message}
          action={
            error.reload && (
              <Button type="button" variant="outline" onClick={onReload} className={buttonClass}>
                {COPY.reload}
              </Button>
            )
          }
        />
      )}

      <ResponsiveDialogFooter>
        <ResponsiveDialogClose render={<Button type="button" variant="outline" className={buttonClass} />}>
          {COPY.cancel}
        </ResponsiveDialogClose>
        <Button
          type="button"
          variant="destructive"
          onClick={archive}
          disabled={pending || preview.status !== "ready"}
          className={`${buttonClass} disabled:cursor-progress`}
        >
          {COPY.archive}
        </Button>
      </ResponsiveDialogFooter>
    </>
  );
}
