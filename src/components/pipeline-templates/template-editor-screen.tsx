"use client";

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Archive, ArrowDown, ArrowUp, Ellipsis, GripVertical, Plus, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { InlineAlert } from "@/components/funding-officers/shared";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import {
  PIPELINE_TEMPLATE_NAME_MAX,
  STAGE_NAME_MAX,
  STAGES_MAX,
  TASK_NAME_MAX,
  TASKS_PER_STAGE_MAX,
} from "@/lib/validation";
import {
  displayStageName,
  type EditorErrors,
  type EditorStage,
  type EditorValues,
  emptyStage,
  firstErrorKey,
  isDirty,
  moveItem,
  newKey,
  newTemplateValues,
  type PipelineTemplateRecord,
  stageMovedMessage,
  stageNameKey,
  stageTasksKey,
  taskMovedMessage,
  taskNameKey,
  toApiBody,
  toEditorErrors,
  validateValues,
  valuesFromRecord,
} from "./editor-state";
import { NEW_TEMPLATE_PATH, PIPELINE_TEMPLATES_PATH, SCREEN_PATH, TEMPLATE_COPY as COPY, templatePath } from "./shared";

type Loaded =
  | { status: "loading" }
  | { status: "error" }
  | { status: "not-found" }
  | { status: "ready"; record: PipelineTemplateRecord | null };

/**
 * The Pipeline Template editor (E3-S2, docs/design/E3-S2.md): `/pengaturan/template-pipeline/baru` adds a
 * template, `/pengaturan/template-pipeline/[id]` edits one (read-only with "Pulihkan" when archived).
 * Saving sends the whole template (PUT replaces every Stage and Task, api.md).
 */
export function TemplateEditorScreen({ templateId }: { templateId?: string }) {
  const router = useRouter();
  const editing = templateId !== undefined;
  const screenPath = editing ? templatePath(templateId) : NEW_TEMPLATE_PATH;
  const [loaded, setLoaded] = useState<Loaded>(editing ? { status: "loading" } : { status: "ready", record: null });
  const [loadCount, setLoadCount] = useState(0);

  const toSignIn = useCallback(() => {
    router.replace(`/masuk?${new URLSearchParams({ next: screenPath })}`);
  }, [router, screenPath]);

  useEffect(() => {
    if (!editing) return;
    const controller = new AbortController();
    apiRequest<PipelineTemplateRecord>(`${PIPELINE_TEMPLATES_PATH}/${templateId}`, { signal: controller.signal })
      .then((result) => {
        if (result.ok) return setLoaded({ status: "ready", record: result.data });
        if (result.status === 401) return toSignIn();
        setLoaded({ status: result.status === 404 ? "not-found" : "error" });
      })
      .catch(() => {
        // Aborted on unmount or when "Coba lagi" starts a new load.
      });
    return () => controller.abort();
  }, [editing, templateId, loadCount, toSignIn]);

  if (loaded.status === "ready") {
    return <TemplateEditor initialRecord={loaded.record} onUnauthorized={toSignIn} />;
  }

  let body: ReactNode;
  if (loaded.status === "loading") body = <EditorSkeleton />;
  else if (loaded.status === "not-found") {
    body = (
      <div className="flex max-w-160 flex-col items-start gap-3">
        <p className="text-base">{COPY.notFound}</p>
        <Link href={SCREEN_PATH} className={cn(buttonVariants({ variant: "outline" }), "h-11 px-4 text-base lg:h-9 lg:text-sm")}>
          {COPY.backToList}
        </Link>
      </div>
    );
  } else {
    body = (
      <div role="alert" className="flex max-w-160 flex-col items-start gap-3">
        <p className="text-base">{COPY.loadError}</p>
        <Button
          variant="outline"
          onClick={() => {
            setLoaded({ status: "loading" });
            setLoadCount((count) => count + 1);
          }}
          className="h-11 px-4 text-base lg:h-9 lg:text-sm"
        >
          {COPY.retry}
        </Button>
      </div>
    );
  }
  return (
    <>
      <PageHeader title={editing ? COPY.editTitle : COPY.newTitle} backHref={SCREEN_PATH} />
      <PageBody>{body}</PageBody>
    </>
  );
}

type FormAlert = { kind: "save-failed" | "conflict" | "message"; message: string; id: number };
type ActionError = { message: string; reload: boolean; id: number };
type FocusRequest = { key: string; id: number; scroll: ScrollLogicalPosition };

const actionClass = "h-12 px-4 text-base lg:h-10";
const smallActionClass = "h-11 px-4 text-base lg:h-9 lg:text-sm";
const iconButtonClass = "size-11 shrink-0 lg:size-9";
/** A one-line field that grows to wrap a long name (DESIGN.md: long names wrap). Enter does not add a line. */
const wrapFieldClass =
  "min-h-12 resize-none px-3 py-2.5 text-base leading-6 md:text-base read-only:cursor-progress lg:min-h-10 lg:py-1.5";

function TemplateEditor({
  initialRecord,
  onUnauthorized,
}: {
  initialRecord: PipelineTemplateRecord | null;
  onUnauthorized: () => void;
}) {
  const router = useRouter();
  const formId = useId();
  const [record, setRecord] = useState(initialRecord);
  const [initial, setInitial] = useState<EditorValues>(() =>
    initialRecord ? valuesFromRecord(initialRecord) : newTemplateValues(),
  );
  const [values, setValues] = useState<EditorValues>(initial);
  // One key per form open, reused on every retry of this create (api.md, Idempotent creates).
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const [errors, setErrors] = useState<EditorErrors>({});
  const [alert, setAlert] = useState<FormAlert | null>(null);
  const [actionError, setActionError] = useState<ActionError | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [actionPending, setActionPending] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [discard, setDiscard] = useState<{ open: boolean; then: (() => void) | null }>({ open: false, then: null });
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; pending: boolean; error: string | null }>({
    open: false,
    pending: false,
    error: null,
  });
  const [announcement, setAnnouncement] = useState("");
  const leavingRef = useRef(false);

  const refs = useRef<Record<string, HTMLElement | null>>({});
  const setRef = (key: string) => (element: HTMLElement | null) => {
    refs.current[key] = element;
  };
  const alertRef = useRef<HTMLDivElement>(null);
  // The element to focus once React has committed the render that shows (or re-enables) it (BUG-2).
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);

  useEffect(() => {
    if (!focusRequest) return;
    const element = refs.current[focusRequest.key];
    if (!element) return;
    element.scrollIntoView({ block: focusRequest.scroll });
    element.focus({ preventScroll: true });
  }, [focusRequest]);

  function focusLater(key: string, scroll: ScrollLogicalPosition = "nearest") {
    setFocusRequest((previous) => ({ key, scroll, id: (previous?.id ?? 0) + 1 }));
  }

  const editing = record !== null;
  const archived = record?.archived ?? false;
  const dirty = !archived && isDirty(values, initial);

  // Leaving the page (reload, closing the tab) with unsaved changes asks the browser's own question.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (leavingRef.current) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  function showAlert(kind: FormAlert["kind"], message: string) {
    setAlert((previous) => ({ kind, message, id: (previous?.id ?? 0) + 1 }));
    requestAnimationFrame(() => {
      alertRef.current?.scrollIntoView({ block: "center" });
      alertRef.current?.focus({ preventScroll: true });
    });
  }

  function showActionError(message: string, reload = false) {
    setActionError((previous) => ({ message, reload, id: (previous?.id ?? 0) + 1 }));
  }

  /** Replaces the editor with a record from the server (after a reload, archive or restore). */
  function applyRecord(next: PipelineTemplateRecord) {
    const nextValues = valuesFromRecord(next);
    setRecord(next);
    setInitial(nextValues);
    setValues(nextValues);
    setErrors({});
  }

  function clearError(...keys: string[]) {
    setErrors((current) => {
      if (!keys.some((key) => current[key])) return current;
      const next = { ...current };
      for (const key of keys) delete next[key];
      return next;
    });
  }

  // ---- Editing ---------------------------------------------------------------------------------------

  function updateStages(update: (stages: EditorStage[]) => EditorStage[]) {
    setValues((current) => ({ ...current, stages: update(current.stages) }));
  }

  function addStage() {
    const stage = emptyStage();
    updateStages((stages) => [...stages, stage]);
    clearError("stages");
    focusLater(stageNameKey(stage.key), "center");
  }

  function removeStage(index: number) {
    if (values.stages.length <= 1) return;
    const remaining = values.stages.filter((_, i) => i !== index);
    updateStages(() => remaining);
    const next = remaining[Math.max(0, index - 1)];
    focusLater(stageNameKey(next.key), "center");
  }

  function moveStage(index: number, direction: -1 | 1) {
    const to = index + direction;
    if (to < 0 || to >= values.stages.length) return;
    const stage = values.stages[index];
    updateStages((stages) => moveItem(stages, index, to));
    setAnnouncement(stageMovedMessage(stage.name, to + 1));
    // Keep focus on the moved Stage's button; at the first or last place that button is disabled, so the other one.
    const atEdge = to === 0 || to === values.stages.length - 1;
    const button = direction === -1 ? (atEdge && to === 0 ? "down" : "up") : atEdge ? "up" : "down";
    focusLater(`stage:${stage.key}:${button}`);
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = values.stages.findIndex((stage) => stage.key === active.id);
    const to = values.stages.findIndex((stage) => stage.key === over.id);
    if (from < 0 || to < 0) return;
    const stage = values.stages[from];
    updateStages((stages) => moveItem(stages, from, to));
    setAnnouncement(stageMovedMessage(stage.name, to + 1));
  }

  function renameStage(index: number, name: string) {
    const stage = values.stages[index];
    updateStages((stages) => stages.map((item, i) => (i === index ? { ...item, name } : item)));
    clearError(stageNameKey(stage.key));
  }

  function updateTasks(stageIndex: number, update: (tasks: EditorStage["tasks"]) => EditorStage["tasks"]) {
    updateStages((stages) => stages.map((stage, i) => (i === stageIndex ? { ...stage, tasks: update(stage.tasks) } : stage)));
  }

  function addTask(stageIndex: number) {
    const task = { key: newKey("t"), name: "" };
    updateTasks(stageIndex, (tasks) => [...tasks, task]);
    clearError(stageTasksKey(values.stages[stageIndex].key));
    focusLater(taskNameKey(task.key), "center");
  }

  function removeTask(stageIndex: number, taskIndex: number) {
    const stage = values.stages[stageIndex];
    const remaining = stage.tasks.filter((_, i) => i !== taskIndex);
    updateTasks(stageIndex, () => remaining);
    clearError(taskNameKey(stage.tasks[taskIndex].key), stageTasksKey(stage.key));
    const next = remaining[Math.max(0, taskIndex - 1)];
    focusLater(next ? taskNameKey(next.key) : `stage:${stage.key}:addTask`, "center");
  }

  function moveTask(stageIndex: number, taskIndex: number, direction: -1 | 1) {
    const stage = values.stages[stageIndex];
    const to = taskIndex + direction;
    if (to < 0 || to >= stage.tasks.length) return;
    const task = stage.tasks[taskIndex];
    updateTasks(stageIndex, (tasks) => moveItem(tasks, taskIndex, to));
    setAnnouncement(taskMovedMessage(task.name, to + 1, stage.name));
    focusLater(`task:${task.key}:menu`);
  }

  function renameTask(stageIndex: number, taskIndex: number, name: string) {
    const task = values.stages[stageIndex].tasks[taskIndex];
    updateTasks(stageIndex, (tasks) => tasks.map((item, i) => (i === taskIndex ? { ...item, name } : item)));
    clearError(taskNameKey(task.key));
  }

  // ---- Saving ----------------------------------------------------------------------------------------

  function showFieldErrors(next: EditorErrors) {
    setErrors(next);
    const first = firstErrorKey(next, values);
    if (first) focusLater(first, "center");
  }

  async function submit() {
    if (pendingRef.current || archived) return;
    setAlert(null);
    setActionError(null);

    const inline = validateValues(values);
    if (Object.keys(inline).length > 0) return showFieldErrors(inline);
    setErrors({});

    pendingRef.current = true;
    setPending(true);
    const sent = values.stages;
    const body = toApiBody(values);
    const result = record
      ? await apiRequest<PipelineTemplateRecord>(`${PIPELINE_TEMPLATES_PATH}/${record.id}`, {
          method: "PUT",
          body: { ...body, version: record.version },
        })
      : await apiRequest<PipelineTemplateRecord>(PIPELINE_TEMPLATES_PATH, { method: "POST", body, idempotencyKey });

    if (result.ok) {
      // Stay disabled while the list opens.
      leavingRef.current = true;
      toast.success(COPY.saved);
      router.push(SCREEN_PATH);
      return;
    }

    pendingRef.current = false;
    setPending(false);
    if (result.status === 401) return onUnauthorized();
    if (result.status === 0 || result.status >= 500) return showAlert("save-failed", COPY.saveFailed);
    if (result.status === 409 && result.error.code === "version_conflict") return showAlert("conflict", result.error.message);
    if (result.status === 422 && result.error.code === "template_archived") {
      await reload(false);
      return showAlert("message", result.error.message);
    }

    const mapped = toEditorErrors(result.error.fields, sent);
    if (Object.keys(mapped.errors).length > 0) {
      showFieldErrors(mapped.errors);
      if (mapped.other.length > 0) showAlert("message", mapped.other.join(" "));
      return;
    }
    showAlert("message", mapped.other.length > 0 ? mapped.other.join(" ") : result.error.message);
  }

  /** "Muat ulang": the latest saved template replaces the editor (EC18). */
  async function reload(focusName = true): Promise<boolean> {
    if (!record) return false;
    setReloading(true);
    const latest = await apiRequest<PipelineTemplateRecord>(`${PIPELINE_TEMPLATES_PATH}/${record.id}`);
    setReloading(false);
    if (!latest.ok) {
      if (latest.status === 401) onUnauthorized();
      else showAlert("message", latest.status === 0 ? COPY.saveFailed : latest.error.message);
      return false;
    }
    applyRecord(latest.data);
    setAlert(null);
    setActionError(null);
    if (focusName && !latest.data.archived) focusLater("name", "center");
    return true;
  }

  // ---- Archive, restore, delete ---------------------------------------------------------------------

  async function changeArchived(action: "archive" | "restore") {
    if (!record || actionPending) return;
    setActionPending(true);
    setActionError(null);
    setAlert(null);
    const result = await apiRequest<PipelineTemplateRecord>(`${PIPELINE_TEMPLATES_PATH}/${record.id}/${action}`, {
      method: "POST",
      body: { version: record.version },
    });
    setActionPending(false);
    if (result.ok) {
      applyRecord(result.data);
      toast.success(action === "archive" ? COPY.archivedToast : COPY.restoredToast);
      focusLater(action === "archive" ? "restore" : "name", "center");
      return;
    }
    if (result.status === 401) return onUnauthorized();
    showActionError(result.status === 0 ? COPY.saveFailed : result.error.message, result.status === 409 && result.error.code === "version_conflict");
  }

  function archive() {
    if (dirty) return setDiscard({ open: true, then: () => void changeArchived("archive") });
    void changeArchived("archive");
  }

  async function deleteTemplate() {
    if (!record || deleteDialog.pending) return;
    setDeleteDialog((current) => ({ ...current, pending: true, error: null }));
    const result = await apiRequest<null>(`${PIPELINE_TEMPLATES_PATH}/${record.id}`, { method: "DELETE" });
    if (result.ok) {
      leavingRef.current = true;
      toast.success(COPY.deleted);
      router.replace(SCREEN_PATH);
      return;
    }
    if (result.status === 401) return onUnauthorized();
    setDeleteDialog((current) => ({
      ...current,
      pending: false,
      error: result.status === 0 ? COPY.saveFailed : result.error.message,
    }));
  }

  /** The back link and "Batal": with unsaved changes, ask "Buang perubahan?" first. */
  function guardLeave(event: MouseEvent<HTMLAnchorElement>) {
    if (!dirty || leavingRef.current) return;
    event.preventDefault();
    setDiscard({
      open: true,
      then: () => {
        leavingRef.current = true;
        router.push(SCREEN_PATH);
      },
    });
  }

  const canDelete = editing && record.pipelineCount === 0;
  const title = editing ? COPY.editTitle : COPY.newTitle;

  const headerActions = editing && (
    <div className="flex gap-2">
      {archived ? (
        <Button onClick={() => void changeArchived("restore")} disabled={actionPending} className="h-9 px-3 text-sm">
          {COPY.restore}
        </Button>
      ) : (
        <Button variant="outline" onClick={archive} disabled={actionPending || pending} className="h-9 px-3 text-sm">
          <Archive aria-hidden />
          {COPY.archive}
        </Button>
      )}
      {canDelete && (
        <Button
          variant="outline"
          onClick={() => setDeleteDialog({ open: true, pending: false, error: null })}
          disabled={actionPending || pending}
          className="h-9 px-3 text-sm text-danger hover:text-danger"
        >
          {COPY.delete}
        </Button>
      )}
    </div>
  );

  const actionErrorAlert = actionError && (
    <InlineAlert
      key={actionError.id}
      message={actionError.message}
      action={
        actionError.reload && (
          <Button type="button" variant="outline" onClick={() => void reload()} disabled={reloading} className={smallActionClass}>
            {COPY.reload}
          </Button>
        )
      }
    />
  );

  const formAlert = alert && (
    <div ref={alertRef} tabIndex={-1} className="outline-none">
      <InlineAlert
        key={alert.id}
        message={alert.message}
        action={
          alert.kind === "save-failed" ? (
            <Button type="button" variant="outline" onClick={() => void submit()} className={smallActionClass}>
              {COPY.retry}
            </Button>
          ) : alert.kind === "conflict" ? (
            <Button type="button" variant="outline" onClick={() => void reload()} disabled={reloading} className={smallActionClass}>
              {COPY.reload}
            </Button>
          ) : undefined
        }
      />
    </div>
  );

  const fieldId = (key: string) => `${formId}-${key.replaceAll(":", "-")}`;

  return (
    <>
      <PageHeader title={title} backHref={SCREEN_PATH} onBack={guardLeave} action={headerActions} />
      <PageBody>
        <p aria-live="polite" className="sr-only" data-testid="template-announcer">
          {announcement}
        </p>

        {archived && record ? (
          <ArchivedView
            record={record}
            alert={formAlert}
            actionError={actionErrorAlert}
            actionPending={actionPending}
            onRestore={() => void changeArchived("restore")}
            restoreRef={setRef("restore")}
            canDelete={canDelete}
            onDelete={() => setDeleteDialog({ open: true, pending: false, error: null })}
          />
        ) : (
          <form
            noValidate
            aria-busy={pending}
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
            className="flex w-full max-w-200 flex-col gap-5"
          >
            {actionError && <div className="hidden lg:block">{actionErrorAlert}</div>}
            {formAlert}

            <div className="flex flex-col gap-2">
              <Label htmlFor={fieldId("name")} className="text-base leading-6">
                {COPY.name}
              </Label>
              <Textarea
                ref={setRef("name")}
                id={fieldId("name")}
                name="name"
                rows={1}
                autoComplete="off"
                maxLength={PIPELINE_TEMPLATE_NAME_MAX}
                value={values.name}
                onChange={(event) => {
                  setValues((current) => ({ ...current, name: singleLine(event.target.value) }));
                  clearError("name");
                }}
                onKeyDown={preventNewLine}
                readOnly={pending}
                aria-invalid={errors.name ? true : undefined}
                aria-describedby={cn(errors.name && `${fieldId("name")}-error`, `${fieldId("name")}-note`)}
                className={wrapFieldClass}
              />
              {errors.name && <FieldError id={`${fieldId("name")}-error`}>{errors.name}</FieldError>}
              <p id={`${fieldId("name")}-note`} className="text-sm text-muted-foreground">
                {COPY.onlyNewPipelines}
              </p>
            </div>

            <section aria-labelledby={fieldId("stages-heading")} className="flex flex-col gap-3">
              <h2 id={fieldId("stages-heading")} className="text-base font-semibold">
                {COPY.stageListLabel}
              </h2>
              {errors.stages && (
                <div ref={setRef("stages")} tabIndex={-1} className="outline-none" data-testid="stages-error">
                  <InlineAlert message={errors.stages} />
                </div>
              )}
              <StageList
                values={values}
                errors={errors}
                pending={pending}
                fieldId={fieldId}
                setRef={setRef}
                onDragEnd={onDragEnd}
                onRenameStage={renameStage}
                onMoveStage={moveStage}
                onRemoveStage={removeStage}
                onAddTask={addTask}
                onRenameTask={renameTask}
                onMoveTask={moveTask}
                onRemoveTask={removeTask}
              />
              {values.stages.length < STAGES_MAX && (
                <Button
                  ref={setRef("addStage")}
                  type="button"
                  variant="outline"
                  onClick={addStage}
                  disabled={pending}
                  className={cn(actionClass, "self-start")}
                >
                  <Plus aria-hidden className="size-5" />
                  {COPY.addStage}
                </Button>
              )}
            </section>

            {editing && (
              <section aria-label={COPY.templateActions} className="flex flex-col gap-3 border-t border-border pt-4 lg:hidden">
                {actionErrorAlert}
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={archive} disabled={actionPending || pending} className={actionClass}>
                    <Archive aria-hidden className="size-5" />
                    {COPY.archive}
                  </Button>
                  {canDelete && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setDeleteDialog({ open: true, pending: false, error: null })}
                      disabled={actionPending || pending}
                      className={cn(actionClass, "text-danger hover:text-danger")}
                    >
                      {COPY.delete}
                    </Button>
                  )}
                </div>
              </section>
            )}

            {/* Below 1024 px "Simpan" stays in thumb reach, just above the bottom navigation. */}
            <div className="sticky bottom-[calc(var(--bottom-nav-height)+env(safe-area-inset-bottom))] z-20 -mx-4 -mb-4 border-t border-border bg-background px-4 py-3 lg:static lg:mx-0 lg:mb-0 lg:border-0 lg:px-0 lg:py-0">
              <div className="flex gap-3">
                <Button type="submit" disabled={pending} className={cn(actionClass, "flex-1 disabled:cursor-progress lg:flex-none lg:px-6")}>
                  {pending ? COPY.saving : COPY.save}
                </Button>
                <Link
                  href={SCREEN_PATH}
                  onClick={guardLeave}
                  className={cn(buttonVariants({ variant: "outline" }), actionClass, "hidden lg:inline-flex")}
                >
                  {COPY.cancel}
                </Link>
              </div>
            </div>
          </form>
        )}
      </PageBody>

      <ResponsiveDialog open={discard.open} onOpenChange={(open) => !open && setDiscard({ open: false, then: null })}>
        <ResponsiveDialogContent>
          <ResponsiveDialogTitle>{COPY.discardTitle}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="text-foreground">{COPY.discardBody}</ResponsiveDialogDescription>
          <ResponsiveDialogFooter>
            <ResponsiveDialogClose render={<Button type="button" variant="outline" className={smallActionClass} />}>
              {COPY.keepEditing}
            </ResponsiveDialogClose>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                const then = discard.then;
                setDiscard({ open: false, then: null });
                then?.();
              }}
              className={smallActionClass}
            >
              {COPY.discard}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      <ResponsiveDialog
        open={deleteDialog.open}
        onOpenChange={(open) => !open && setDeleteDialog((current) => ({ ...current, open: false }))}
      >
        <ResponsiveDialogContent>
          {record && (
            <>
              <ResponsiveDialogTitle>{COPY.deleteTitle(record.name)}</ResponsiveDialogTitle>
              <ResponsiveDialogDescription className="text-foreground">{COPY.deleteBody}</ResponsiveDialogDescription>
              {deleteDialog.error && <InlineAlert message={deleteDialog.error} />}
              <ResponsiveDialogFooter>
                <ResponsiveDialogClose render={<Button type="button" variant="outline" className={smallActionClass} />}>
                  {COPY.cancel}
                </ResponsiveDialogClose>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => void deleteTemplate()}
                  disabled={deleteDialog.pending}
                  className={cn(smallActionClass, "disabled:cursor-progress")}
                >
                  {COPY.delete}
                </Button>
              </ResponsiveDialogFooter>
            </>
          )}
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}

function singleLine(text: string): string {
  return text.replace(/[\r\n]+/g, " ");
}

function preventNewLine(event: KeyboardEvent<HTMLTextAreaElement>) {
  if (event.key === "Enter") event.preventDefault();
}

type StageListProps = {
  values: EditorValues;
  errors: EditorErrors;
  pending: boolean;
  fieldId: (key: string) => string;
  setRef: (key: string) => (element: HTMLElement | null) => void;
  onDragEnd: (event: DragEndEvent) => void;
  onRenameStage: (index: number, name: string) => void;
  onMoveStage: (index: number, direction: -1 | 1) => void;
  onRemoveStage: (index: number) => void;
  onAddTask: (stageIndex: number) => void;
  onRenameTask: (stageIndex: number, taskIndex: number, name: string) => void;
  onMoveTask: (stageIndex: number, taskIndex: number, direction: -1 | 1) => void;
  onRemoveTask: (stageIndex: number, taskIndex: number) => void;
};

/** The ordered Stages. Reorder with the move buttons (every width) or by dragging the handle (from 768 px). */
function StageList(props: StageListProps) {
  const { values, onDragEnd } = props;
  const sensors = useSensors(
    // The handle sets `touch-action: none`, so a pointer (mouse, pen or finger) drags it right away.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const nameOf = (id: string | number) => displayStageName(values.stages.find((stage) => stage.key === id)?.name ?? "");
  const positionOf = (id: string | number) => values.stages.findIndex((stage) => stage.key === id) + 1;

  return (
    <DndContext
      id="template-stages"
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      accessibility={{
        screenReaderInstructions: {
          draggable:
            "Tekan spasi atau Enter untuk mengangkat Tahap. Pindahkan dengan panah atas dan bawah, letakkan dengan spasi atau Enter, batalkan dengan Escape.",
        },
        announcements: {
          onDragStart: ({ active }) => `${nameOf(active.id)} diangkat, tahap ${positionOf(active.id)}.`,
          onDragOver: ({ active, over }) => (over ? `${nameOf(active.id)} di posisi tahap ${positionOf(over.id)}.` : undefined),
          // The editor's own live region says where it landed ("Identifikasi sekarang tahap 2.").
          onDragEnd: () => undefined,
          onDragCancel: ({ active }) => `Pemindahan ${nameOf(active.id)} dibatalkan.`,
        },
      }}
    >
      <SortableContext items={values.stages.map((stage) => stage.key)} strategy={verticalListSortingStrategy}>
        <ol aria-label={COPY.stageListLabel} className="flex flex-col border-t border-border">
          {values.stages.map((stage, index) => (
            <SortableStage key={stage.key} stage={stage} index={index} {...props} />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}

function SortableStage({
  stage,
  index,
  values,
  errors,
  pending,
  fieldId,
  setRef,
  onRenameStage,
  onMoveStage,
  onRemoveStage,
  onAddTask,
  onRenameTask,
  onMoveTask,
  onRemoveTask,
}: StageListProps & { stage: EditorStage; index: number }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: stage.key,
    disabled: pending,
  });
  const count = values.stages.length;
  const position = index + 1;
  const label = displayStageName(stage.name);
  const nameKey = stageNameKey(stage.key);
  const nameError = errors[nameKey];
  const tasksError = errors[stageTasksKey(stage.key)];

  return (
    <li
      ref={setNodeRef}
      data-testid="template-stage"
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "relative flex flex-col gap-2 border-b border-border bg-background py-3",
        isDragging && "z-10 shadow-md",
      )}
    >
      <div className="flex items-start gap-1">
        <button
          ref={setActivatorNodeRef}
          type="button"
          {...attributes}
          {...listeners}
          aria-label={COPY.dragHandle(label)}
          disabled={pending}
          className="-ml-2 hidden size-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-muted-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:cursor-grabbing md:flex lg:size-10"
        >
          <GripVertical aria-hidden className="size-5" />
        </button>
        <span
          aria-hidden
          className="flex h-12 w-6 shrink-0 items-center justify-center text-base font-semibold tabular-nums lg:h-10"
        >
          {position}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Label htmlFor={fieldId(nameKey)} className="sr-only">
            {COPY.stageName(position)}
          </Label>
          <Textarea
            ref={setRef(nameKey)}
            id={fieldId(nameKey)}
            rows={1}
            autoComplete="off"
            maxLength={STAGE_NAME_MAX}
            value={stage.name}
            onChange={(event) => onRenameStage(index, singleLine(event.target.value))}
            onKeyDown={preventNewLine}
            readOnly={pending}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? `${fieldId(nameKey)}-error` : undefined}
            className={cn(wrapFieldClass, "font-medium")}
          />
          {nameError && <FieldError id={`${fieldId(nameKey)}-error`}>{nameError}</FieldError>}
        </div>
        <div className="flex shrink-0 items-center lg:h-10">
          <Button
            ref={setRef(`stage:${stage.key}:up`)}
            type="button"
            variant="ghost"
            size="icon"
            aria-label={COPY.moveUp(label)}
            onClick={() => onMoveStage(index, -1)}
            disabled={pending || index === 0}
            className={iconButtonClass}
          >
            <ArrowUp aria-hidden className="size-5" />
          </Button>
          <Button
            ref={setRef(`stage:${stage.key}:down`)}
            type="button"
            variant="ghost"
            size="icon"
            aria-label={COPY.moveDown(label)}
            onClick={() => onMoveStage(index, 1)}
            disabled={pending || index === count - 1}
            className={iconButtonClass}
          >
            <ArrowDown aria-hidden className="size-5" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={COPY.stageActions(label)}
                  disabled={pending}
                  className={cn(iconButtonClass, "-mr-2 lg:mr-0")}
                />
              }
            >
              <Ellipsis aria-hidden className="size-5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-auto min-w-48">
              <DropdownMenuItem
                variant="destructive"
                disabled={count <= 1}
                onClick={() => onRemoveStage(index)}
                className="min-h-11 px-3 text-base lg:min-h-9 lg:text-sm"
              >
                {COPY.removeStage}
              </DropdownMenuItem>
              {count <= 1 && <p className="px-3 pb-2 text-sm text-muted-foreground">{COPY.lastStageHint}</p>}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Tasks sit under the Stage name, indented past its number. */}
      <div className="flex flex-col gap-2 pl-7 md:pl-17 lg:pl-16">
        {stage.tasks.length > 0 && (
          <ul aria-label={`Tugas di ${label}`} className="flex flex-col gap-2">
            {stage.tasks.map((task, taskIndex) => {
              const key = taskNameKey(task.key);
              const taskLabel = COPY.taskLabel(taskIndex + 1, label);
              const taskError = errors[key];
              const taskName = task.name.trim() || `Tugas ${taskIndex + 1}`;
              return (
                <li key={task.key} className="flex items-start gap-1">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <Label htmlFor={fieldId(key)} className="sr-only">
                      {taskLabel}
                    </Label>
                    <Textarea
                      ref={setRef(key)}
                      id={fieldId(key)}
                      rows={1}
                      autoComplete="off"
                      maxLength={TASK_NAME_MAX}
                      value={task.name}
                      onChange={(event) => onRenameTask(index, taskIndex, singleLine(event.target.value))}
                      onKeyDown={preventNewLine}
                      readOnly={pending}
                      aria-invalid={taskError ? true : undefined}
                      aria-describedby={taskError ? `${fieldId(key)}-error` : undefined}
                      className={wrapFieldClass}
                    />
                    {taskError && <FieldError id={`${fieldId(key)}-error`}>{taskError}</FieldError>}
                  </div>
                  {stage.tasks.length > 1 ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            ref={setRef(`task:${task.key}:menu`)}
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={COPY.taskActions(taskName)}
                            disabled={pending}
                            className={iconButtonClass}
                          />
                        }
                      >
                        <Ellipsis aria-hidden className="size-5" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-auto min-w-48">
                        <DropdownMenuItem
                          disabled={taskIndex === 0}
                          onClick={() => onMoveTask(index, taskIndex, -1)}
                          className="min-h-11 px-3 text-base lg:min-h-9 lg:text-sm"
                        >
                          <ArrowUp aria-hidden />
                          {COPY.moveTaskUp}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={taskIndex === stage.tasks.length - 1}
                          onClick={() => onMoveTask(index, taskIndex, 1)}
                          className="min-h-11 px-3 text-base lg:min-h-9 lg:text-sm"
                        >
                          <ArrowDown aria-hidden />
                          {COPY.moveTaskDown}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <span aria-hidden className={iconButtonClass} />
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={COPY.removeTaskLabel(taskName)}
                    onClick={() => onRemoveTask(index, taskIndex)}
                    disabled={pending}
                    className={cn(iconButtonClass, "-mr-2 lg:mr-0")}
                  >
                    <X aria-hidden className="size-5" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        {tasksError && <FieldError id={`${fieldId(stageTasksKey(stage.key))}-error`}>{tasksError}</FieldError>}
        {stage.tasks.length < TASKS_PER_STAGE_MAX && (
          <Button
            ref={setRef(`stage:${stage.key}:addTask`)}
            type="button"
            variant="ghost"
            onClick={() => onAddTask(index)}
            disabled={pending}
            aria-label={`${COPY.addTask} di ${label}`}
            className="-ml-3 h-11 self-start px-3 text-base text-primary hover:bg-accent hover:text-primary lg:h-9 lg:text-sm"
          >
            <Plus aria-hidden className="size-5 lg:size-4" />
            {COPY.addTask}
          </Button>
        )}
      </div>
    </li>
  );
}

/** An archived template: read-only, with "Pulihkan" (EC21). */
function ArchivedView({
  record,
  alert,
  actionError,
  actionPending,
  onRestore,
  restoreRef,
  canDelete,
  onDelete,
}: {
  record: PipelineTemplateRecord;
  alert: ReactNode;
  actionError: ReactNode;
  actionPending: boolean;
  onRestore: () => void;
  restoreRef: (element: HTMLElement | null) => void;
  canDelete: boolean;
  onDelete: () => void;
}) {
  const stages = [...record.stages].sort((a, b) => a.position - b.position);
  return (
    <div className="flex w-full max-w-200 flex-col gap-5">
      {alert}
      <div data-testid="archived-notice" className="flex flex-col items-start gap-3 rounded-lg border border-border bg-muted p-3">
        <p className="flex items-start gap-2 text-base">
          <Archive aria-hidden className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          {COPY.archivedNotice}
        </p>
        {actionError}
        <div className="flex flex-wrap gap-2 lg:hidden">
          <Button ref={restoreRef} type="button" onClick={onRestore} disabled={actionPending} className={actionClass}>
            {COPY.restore}
          </Button>
          {canDelete && (
            <Button type="button" variant="outline" onClick={onDelete} disabled={actionPending} className={cn(actionClass, "text-danger hover:text-danger")}>
              {COPY.delete}
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">{COPY.name}</p>
        <p className="text-xl font-semibold break-words">{record.name}</p>
        <p className="text-sm text-muted-foreground">{COPY.onlyNewPipelines}</p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">{COPY.stageListLabel}</h2>
        <ol aria-label={COPY.stageListLabel} className="flex flex-col border-t border-border">
          {stages.map((stage) => (
            <li key={stage.id} className="flex flex-col gap-2 border-b border-border py-3">
              <p className="flex items-start gap-2 text-base font-medium">
                <span aria-hidden className="w-6 shrink-0 text-center tabular-nums">
                  {stage.position}
                </span>
                <span className="min-w-0 break-words">
                  <span className="sr-only">Tahap {stage.position}: </span>
                  {stage.name}
                </span>
              </p>
              {stage.tasks.length > 0 ? (
                <ul className="flex list-disc flex-col gap-1 pl-12 text-base marker:text-muted-foreground">
                  {[...stage.tasks]
                    .sort((a, b) => a.position - b.position)
                    .map((task) => (
                      <li key={task.id} className="break-words">
                        {task.name}
                      </li>
                    ))}
                </ul>
              ) : (
                <p className="pl-8 text-sm text-muted-foreground">{COPY.noTasks}</p>
              )}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="text-sm text-danger">
      {children}
    </p>
  );
}

/** Loading: the editor's shape, without values. */
function EditorSkeleton() {
  return (
    <div aria-busy className="flex w-full max-w-200 flex-col gap-5">
      <span className="sr-only">{COPY.loading}</span>
      <div aria-hidden className="flex flex-col gap-2">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-12 w-full lg:h-10" />
        <Skeleton className="h-4 w-64" />
      </div>
      <div aria-hidden className="flex flex-col border-t border-border">
        {[0, 1, 2].map((item) => (
          <div key={item} className="flex flex-col gap-2 border-b border-border py-3">
            <div className="flex items-center gap-2">
              <Skeleton className="size-6" />
              <Skeleton className="h-12 flex-1 lg:h-10" />
              <Skeleton className="h-11 w-28 lg:h-9" />
            </div>
            <Skeleton className="ml-8 h-12 w-3/4 lg:h-10" />
          </div>
        ))}
      </div>
    </div>
  );
}
