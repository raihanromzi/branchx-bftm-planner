"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { InlineAlert } from "@/components/funding-officers/shared";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest } from "@/lib/api-client";
import { defaultTemplateId, type TemplateOption } from "./detail-state";
import { PROSPECT_DETAIL_COPY as COPY } from "./shared";

const selectClass =
  "h-12 w-full min-w-0 appearance-none rounded-lg border border-input bg-background pr-10 pl-3 text-base text-foreground focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-progress disabled:opacity-60 lg:h-10 dark:bg-input/30";
const buttonClass = "h-11 px-4 text-base lg:h-9 lg:text-sm";

/**
 * "Mulai Pipeline" (docs/design/E2-S4.md): a dialog, a bottom sheet on mobile, with a template select that
 * starts on the only active template. POST /api/pipelines, with one Idempotency-Key per opening of the dialog.
 */
export function StartPipelineDialog({
  open,
  prospectId,
  onClose,
  onStarted,
  onUnauthorized,
}: {
  open: boolean;
  prospectId: string;
  onClose: () => void;
  /** After a `201`, or after a `409` (the Prospect already has a Pipeline): the page reloads its data. */
  onStarted: (started: boolean) => void;
  onUnauthorized: () => void;
}) {
  return (
    <ResponsiveDialog open={open} onOpenChange={(next) => !next && onClose()}>
      <ResponsiveDialogContent>
        <StartPipelineForm prospectId={prospectId} onStarted={onStarted} onUnauthorized={onUnauthorized} />
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

type Templates = { status: "loading" } | { status: "error" } | { status: "ready"; items: TemplateOption[] };

function StartPipelineForm({
  prospectId,
  onStarted,
  onUnauthorized,
}: {
  prospectId: string;
  onStarted: (started: boolean) => void;
  onUnauthorized: () => void;
}) {
  const selectId = useId();
  const [templates, setTemplates] = useState<Templates>({ status: "loading" });
  const [loadCount, setLoadCount] = useState(0);
  const [templateId, setTemplateId] = useState("");
  const [pending, setPending] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per opening of the dialog, reused on a retry (api.md, Idempotent creates; EC15).
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<{ items: TemplateOption[] }>("/api/pipeline-templates", { signal: controller.signal })
      .then((result) => {
        if (result.status === 401) return onUnauthorized();
        if (!result.ok) return setTemplates({ status: "error" });
        const items = result.data.items.filter((item) => !item.archived);
        setTemplates({ status: "ready", items });
        setTemplateId(defaultTemplateId(items));
      })
      .catch(() => {
        // Aborted when the dialog closes.
      });
    return () => controller.abort();
  }, [loadCount, onUnauthorized]);

  async function start() {
    if (pending || conflict || !templateId) return;
    setPending(true);
    setError(null);
    const result = await apiRequest("/api/pipelines", {
      method: "POST",
      body: { prospectId, templateId },
      idempotencyKey,
    });
    setPending(false);
    if (result.ok) return onStarted(true);
    if (result.status === 401) return onUnauthorized();
    // EC16: another tab started one first. Refresh, then leave this stale dialog non-submittable.
    if (result.status === 409 && result.error.code === "pipeline_already_open") {
      setConflict(true);
      onStarted(false);
    }
    setError(result.status === 0 ? COPY.actionFailed : result.error.message);
  }

  const items = templates.status === "ready" ? templates.items : [];

  return (
    <>
      <ResponsiveDialogTitle>{COPY.startPipeline}</ResponsiveDialogTitle>

      {templates.status === "loading" && (
        <div aria-busy className="flex flex-col gap-2">
          <span className="sr-only">{COPY.loading}</span>
          <Skeleton aria-hidden className="h-5 w-24" />
          <Skeleton aria-hidden className="h-12 w-full lg:h-10" />
        </div>
      )}

      {templates.status === "error" && (
        <InlineAlert
          message={COPY.templatesFailed}
          action={
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setTemplates({ status: "loading" });
                setLoadCount((count) => count + 1);
              }}
              className={buttonClass}
            >
              {COPY.retry}
            </Button>
          }
        />
      )}

      {templates.status === "ready" && items.length === 0 && <p className="text-base">{COPY.noActiveTemplate}</p>}

      {templates.status === "ready" && items.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={selectId} className="text-base font-medium">
            {COPY.template}
          </label>
          <div className="relative">
            <select
              id={selectId}
              value={templateId}
              onChange={(event) => setTemplateId(event.target.value)}
              disabled={pending || conflict}
              className={selectClass}
            >
              {templateId === "" && <option value="">{COPY.chooseTemplate}</option>}
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-3 size-5 -translate-y-1/2 text-muted-foreground" />
          </div>
        </div>
      )}

      {error && <InlineAlert message={error} />}

      <ResponsiveDialogFooter>
        <ResponsiveDialogClose render={<Button type="button" variant="outline" className={buttonClass} />}>
          {COPY.cancel}
        </ResponsiveDialogClose>
        <Button
          type="button"
          onClick={start}
          disabled={pending || conflict || !templateId}
          className={`${buttonClass} disabled:cursor-progress`}
        >
          {pending ? COPY.starting : COPY.start}
        </Button>
      </ResponsiveDialogFooter>
    </>
  );
}
