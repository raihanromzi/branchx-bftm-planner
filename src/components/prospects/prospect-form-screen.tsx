"use client";

import { ChevronDown, LocateFixed, TriangleAlert, UserPlus } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { InlineAlert } from "@/components/funding-officers/shared";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { FREE_TEXT_MAX, PROSPECT_CATEGORIES, PROSPECT_CATEGORY_LABELS, type ProspectCategory } from "@/lib/validation";
import {
  characterCount,
  coordinatesToLocation,
  coordinateText,
  EMPTY_FORM,
  type FieldErrors,
  type FieldKey,
  firstErrorField,
  type FormLocation,
  formatLocation,
  limitCharacters,
  type ProspectFormValues,
  type ProspectRecord,
  type ProspectSaveResult,
  toApiBody,
  toFieldErrors,
  validateValues,
  valuesFromRecord,
} from "./form-state";
import {
  editProspectPath,
  FUNDING_OFFICER_SETTINGS_PATH,
  type FundingOfficerOption,
  NEW_PROSPECT_PATH,
  PROSPECT_FORM_COPY as COPY,
  PROSPECTS_PATH,
  prospectPath,
  SCREEN_PATH,
} from "./shared";

// Leaflet needs `window`: the map loads on the client only, with a placeholder of the same size meanwhile.
const LocationPickerMap = dynamic(() => import("./location-picker-map"), {
  ssr: false,
  loading: () => <Skeleton className="size-full rounded-none" />,
});

/** GPS: high accuracy, and give up after 15 s (docs/design/E2-S3.md, EC33). */
const GPS_OPTIONS: PositionOptions = { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 };

type Loaded =
  | { status: "loading" }
  | { status: "error" }
  | { status: "not-found" }
  | { status: "ready"; officers: FundingOfficerOption[]; record: ProspectRecord | null };

/**
 * The Prospect form (E2-S3, docs/design/E2-S3.md): `/prospect/baru` adds a Prospect, `/prospect/[id]/ubah`
 * edits one. Reads the Funding Officers (and the Prospect, to edit) on the client (ADR 0003).
 */
export function ProspectFormScreen({ prospectId }: { prospectId?: string }) {
  const router = useRouter();
  const editing = prospectId !== undefined;
  const screenPath = editing ? editProspectPath(prospectId) : NEW_PROSPECT_PATH;
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  const [loadCount, setLoadCount] = useState(0);

  const toSignIn = useCallback(() => {
    router.replace(`/masuk?${new URLSearchParams({ next: screenPath })}`);
  }, [router, screenPath]);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    Promise.all([
      apiRequest<{ items: FundingOfficerOption[] }>("/api/funding-officers", { signal }),
      editing ? apiRequest<ProspectRecord>(`${PROSPECTS_PATH}/${prospectId}`, { signal }) : Promise.resolve(null),
    ])
      .then(([officers, record]) => {
        if (officers.status === 401 || record?.status === 401) return toSignIn();
        if (record && !record.ok && record.status === 404) return setLoaded({ status: "not-found" });
        if (!officers.ok || (record && !record.ok)) return setLoaded({ status: "error" });
        setLoaded({ status: "ready", officers: officers.data.items, record: record?.ok ? record.data : null });
      })
      .catch(() => {
        // Aborted on unmount or when "Coba lagi" starts a new load.
      });
    return () => controller.abort();
  }, [editing, prospectId, loadCount, toSignIn]);

  const title = editing ? COPY.editTitle : COPY.newTitle;
  const backHref = editing ? prospectPath(prospectId) : SCREEN_PATH;

  let body: ReactNode;
  if (loaded.status === "loading") {
    body = <FormSkeleton />;
  } else if (loaded.status === "error") {
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
  } else if (loaded.status === "not-found") {
    body = (
      <Notice message={COPY.notFound} href={SCREEN_PATH} linkText={COPY.backToList} />
    );
  } else if (loaded.record?.archived) {
    body = <Notice message={COPY.archived} href={prospectPath(loaded.record.id)} linkText={COPY.openProspect} />;
  } else if (!loaded.record && !loaded.officers.some((officer) => officer.active)) {
    // EC2: a Prospect needs an active Funding Officer, so there is nothing to fill in yet.
    body = (
      <div className="flex max-w-160 flex-col items-start gap-4">
        <p className="text-base">{COPY.noActiveOfficers}</p>
        <Link href={FUNDING_OFFICER_SETTINGS_PATH} className={cn(buttonVariants(), "h-11 px-4 text-base lg:h-9 lg:text-sm")}>
          <UserPlus aria-hidden />
          {COPY.openOfficerSettings}
        </Link>
      </div>
    );
  } else {
    body = (
      <ProspectForm
        record={loaded.record}
        officers={loaded.officers}
        onUnauthorized={toSignIn}
        backHref={backHref}
      />
    );
  }

  return (
    <>
      <PageHeader title={title} backHref={backHref} />
      <PageBody>{body}</PageBody>
    </>
  );
}

function Notice({ message, href, linkText }: { message: string; href: string; linkText: string }) {
  return (
    <div className="flex max-w-160 flex-col items-start gap-3">
      <p className="text-base">{message}</p>
      <Link href={href} className={cn(buttonVariants({ variant: "outline" }), "h-11 px-4 text-base lg:h-9 lg:text-sm")}>
        {linkText}
      </Link>
    </div>
  );
}

type GpsState = "idle" | "locating" | "denied" | "failed";
type FormAlert = { kind: "save-failed" | "conflict" | "message"; message: string; id: number };
type DuplicateState = ProspectSaveResult & { mode: "created" | "updated" };

const inputClass = "h-12 px-3 text-base md:text-base read-only:cursor-progress lg:h-10";
const selectClass =
  "h-12 w-full min-w-0 appearance-none rounded-lg border border-input bg-background pr-10 pl-3 text-base text-foreground focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 disabled:cursor-progress disabled:opacity-60 lg:h-10 dark:bg-input/30";
const actionClass = "h-12 px-4 text-base lg:h-10";

function ProspectForm({
  record,
  officers,
  onUnauthorized,
  backHref,
}: {
  record: ProspectRecord | null;
  officers: FundingOfficerOption[];
  onUnauthorized: () => void;
  backHref: string;
}) {
  const router = useRouter();
  const formId = useId();
  const fieldId = (field: string) => `${formId}-${field.replace(".", "-")}`;

  const activeOfficers = officers.filter((officer) => officer.active);
  const [values, setValues] = useState<ProspectFormValues>(() =>
    record
      ? valuesFromRecord(record)
      : { ...EMPTY_FORM, fundingOfficerId: activeOfficers.length === 1 ? activeOfficers[0].id : "" },
  );
  const [version, setVersion] = useState(record?.version ?? 0);
  // One key per form open, reused on every retry of this create (api.md, Idempotent creates; EC15).
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const [latText, setLatText] = useState(values.location ? coordinateText(values.location.lat) : "");
  const [lngText, setLngText] = useState(values.location ? coordinateText(values.location.lng) : "");
  const [coordinateError, setCoordinateError] = useState<string | null>(null);
  const [recenterKey, setRecenterKey] = useState(0);
  const [gps, setGps] = useState<GpsState>("idle");

  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [reloading, setReloading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [alert, setAlert] = useState<FormAlert | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateState | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [discardError, setDiscardError] = useState(false);

  const fieldRefs = useRef<Partial<Record<FieldKey, HTMLElement | null>>>({});
  const alertRef = useRef<HTMLDivElement>(null);
  const duplicateRef = useRef<HTMLDivElement>(null);
  // The field to focus once React has committed the render that re-enables it (BUG-2).
  const [focusRequest, setFocusRequest] = useState<{ field: FieldKey; id: number } | null>(null);

  useEffect(() => {
    if (!focusRequest) return;
    const element = fieldRefs.current[focusRequest.field];
    element?.scrollIntoView({ block: "center" });
    element?.focus({ preventScroll: true });
  }, [focusRequest]);

  // The Funding Officer select lists the active ones, plus the Prospect's own when it is no longer active.
  const currentOfficer = record?.fundingOfficer;
  const officerOptions =
    currentOfficer && !currentOfficer.active ? [...activeOfficers, currentOfficer] : activeOfficers;

  function set<K extends keyof ProspectFormValues>(field: K, value: ProspectFormValues[K], errorKey: FieldKey) {
    setValues((current) => ({ ...current, [field]: value }));
    setFieldErrors((errors) => (errors[errorKey] ? { ...errors, [errorKey]: undefined } : errors));
  }

  function showAlert(kind: FormAlert["kind"], message: string) {
    // A new id re-mounts the alert, so a repeated message is announced again.
    setAlert((previous) => ({ kind, message, id: (previous?.id ?? 0) + 1 }));
    requestAnimationFrame(() => {
      alertRef.current?.scrollIntoView({ block: "center" });
      alertRef.current?.focus({ preventScroll: true });
    });
  }

  function focusField(field: FieldKey) {
    // Focus in an effect, after the commit that ends `pending`: a select disabled while saving cannot take
    // focus until then, and an animation frame can run before React has committed (BUG-2).
    setFocusRequest((previous) => ({ field, id: (previous?.id ?? 0) + 1 }));
  }

  // Location: from the map (tap or drag), GPS, or the two coordinate inputs.
  const setLocation = useCallback((location: FormLocation | null, recenter: boolean) => {
    setValues((current) => ({ ...current, location }));
    setLatText(location ? coordinateText(location.lat) : "");
    setLngText(location ? coordinateText(location.lng) : "");
    setCoordinateError(null);
    setFieldErrors((errors) => (errors.location ? { ...errors, location: undefined } : errors));
    if (recenter) setRecenterKey((key) => key + 1);
  }, []);

  const pickOnMap = useCallback(
    (lat: number, lng: number) => {
      if (pendingRef.current) return;
      setGps((state) => (state === "locating" ? state : "idle"));
      setLocation({ lat, lng, accuracy: null }, false);
    },
    [setLocation],
  );

  function locateMe() {
    if (!("geolocation" in navigator)) return setGps("failed");
    setGps("locating");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setGps("idle");
        setLocation(
          { lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy },
          true,
        );
      },
      (error) => setGps(error.code === error.PERMISSION_DENIED ? "denied" : "failed"),
      GPS_OPTIONS,
    );
  }

  function onCoordinateChange(lat: string, lng: string) {
    setLatText(lat);
    setLngText(lng);
    const result = coordinatesToLocation(lat, lng);
    setValues((current) => ({ ...current, location: result.location }));
    setCoordinateError(result.error);
    setFieldErrors((errors) => (errors.location ? { ...errors, location: undefined } : errors));
  }

  async function submit() {
    if (pendingRef.current) return;
    setAlert(null);

    const errors = validateValues(values, coordinateError);
    const first = firstErrorField(errors);
    if (first) {
      setFieldErrors(errors);
      focusField(first);
      return;
    }

    pendingRef.current = true;
    setPending(true);
    const body = toApiBody(values);
    const result = record
      ? await apiRequest<ProspectSaveResult>(`${PROSPECTS_PATH}/${record.id}`, {
          method: "PATCH",
          body: { ...body, version },
        })
      : await apiRequest<ProspectSaveResult>(PROSPECTS_PATH, { method: "POST", body, idempotencyKey });

    if (result.ok) {
      if (result.data.duplicates.length > 0) {
        // EC14: saved, but other Prospects share the name. The Admin decides what happens next.
        setVersion(result.data.prospect.version);
        setDuplicates({ ...result.data, mode: record ? "updated" : "created" });
        pendingRef.current = false;
        setPending(false);
        requestAnimationFrame(() => {
          duplicateRef.current?.scrollIntoView({ block: "start" });
          duplicateRef.current?.focus({ preventScroll: true });
        });
        return;
      }
      // Stay disabled while the detail page opens.
      return goToSaved(result.data.prospect.id);
    }

    pendingRef.current = false;
    setPending(false);
    if (result.status === 401) return onUnauthorized();
    if (result.status === 0 || result.status >= 500) return showAlert("save-failed", COPY.saveFailed);
    if (result.status === 409 && result.error.code === "version_conflict") return showAlert("conflict", result.error.message);

    const serverErrors = toFieldErrors(result.error.fields);
    if (result.error.code === "funding_officer_inactive" || result.error.code === "funding_officer_not_found") {
      serverErrors.fundingOfficerId = result.error.message;
    }
    const firstServer = firstErrorField(serverErrors);
    if (firstServer) {
      setFieldErrors(serverErrors);
      focusField(firstServer);
      return;
    }
    showAlert("message", result.error.message);
  }

  function goToSaved(id: string) {
    toast.success(COPY.saved);
    router.replace(prospectPath(id));
  }

  async function reload() {
    if (!record) return;
    setReloading(true);
    const latest = await apiRequest<ProspectRecord>(`${PROSPECTS_PATH}/${record.id}`);
    setReloading(false);
    if (!latest.ok) {
      if (latest.status === 401) return onUnauthorized();
      return showAlert(latest.status === 0 ? "save-failed" : "message", latest.status === 0 ? COPY.saveFailed : latest.error.message);
    }
    const next = valuesFromRecord(latest.data);
    setValues(next);
    setLocation(next.location, true);
    setVersion(latest.data.version);
    setFieldErrors({});
    setAlert(null);
    focusField("name");
  }

  async function discardNew() {
    if (!duplicates) return;
    setDiscarding(true);
    setDiscardError(false);
    const { prospect } = duplicates;
    const result = await apiRequest<ProspectRecord>(`${PROSPECTS_PATH}/${prospect.id}/archive`, {
      method: "POST",
      body: { version: prospect.version },
    });
    if (result.ok) {
      toast.success(COPY.discarded);
      router.replace(SCREEN_PATH);
      return;
    }
    setDiscarding(false);
    if (result.status === 401) return onUnauthorized();
    setDiscardError(true);
  }

  function renameAgain() {
    setDuplicates(null);
    focusField("name");
  }

  const locked = pending || duplicates !== null;
  const errorProps = (field: FieldKey) => ({
    "aria-invalid": fieldErrors[field] ? true : undefined,
    "aria-describedby": fieldErrors[field] ? `${fieldId(field)}-error` : undefined,
  });
  const noteCount = characterCount(values.note);

  return (
    <form
      noValidate
      aria-busy={pending}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="flex w-full max-w-160 flex-col gap-5 xl:max-w-240"
    >
      {duplicates && (
        <DuplicateWarning
          ref={duplicateRef}
          state={duplicates}
          discarding={discarding}
          discardError={discardError}
          onKeep={() => goToSaved(duplicates.prospect.id)}
          onDiscard={discardNew}
          onRename={renameAgain}
        />
      )}

      {alert && (
        <div ref={alertRef} tabIndex={-1} className="outline-none">
          <InlineAlert
            key={alert.id}
            message={alert.message}
            action={
              alert.kind === "save-failed" ? (
                <Button type="button" variant="outline" onClick={() => void submit()} className="h-11 px-4 text-base lg:h-9 lg:text-sm">
                  {COPY.retry}
                </Button>
              ) : alert.kind === "conflict" ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void reload()}
                  disabled={reloading}
                  className="h-11 px-4 text-base lg:h-9 lg:text-sm"
                >
                  {COPY.reload}
                </Button>
              ) : undefined
            }
          />
        </div>
      )}

      <p className="text-sm text-muted-foreground">{COPY.requiredNote}</p>

      <fieldset disabled={duplicates !== null} className="contents">
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2 xl:gap-x-10">
          {/* Nama, Funding Officer, Kategori */}
          <div className="flex flex-col gap-5 xl:col-start-1">
            <Field id={fieldId("name")} label={COPY.name} required error={fieldErrors.name}>
              <Input
                ref={(element) => {
                  fieldRefs.current.name = element;
                }}
                id={fieldId("name")}
                name="name"
                autoComplete="off"
                value={values.name}
                onChange={(event) => set("name", event.target.value, "name")}
                readOnly={pending}
                {...errorProps("name")}
                className={inputClass}
              />
            </Field>

            <Field id={fieldId("fundingOfficerId")} label={COPY.fundingOfficer} required error={fieldErrors.fundingOfficerId}>
              <SelectBox>
                <select
                  ref={(element) => {
                    fieldRefs.current.fundingOfficerId = element;
                  }}
                  id={fieldId("fundingOfficerId")}
                  name="fundingOfficerId"
                  value={values.fundingOfficerId}
                  onChange={(event) => set("fundingOfficerId", event.target.value, "fundingOfficerId")}
                  disabled={pending}
                  {...errorProps("fundingOfficerId")}
                  className={selectClass}
                >
                  {values.fundingOfficerId === "" && <option value="">{COPY.chooseFundingOfficer}</option>}
                  {officerOptions.map((officer) => (
                    <option key={officer.id} value={officer.id}>
                      {officer.active ? officer.name : `${officer.name}${COPY.inactiveSuffix}`}
                    </option>
                  ))}
                </select>
              </SelectBox>
            </Field>

            <Field id={fieldId("category")} label={COPY.category} error={fieldErrors.category}>
              <SelectBox>
                <select
                  ref={(element) => {
                    fieldRefs.current.category = element;
                  }}
                  id={fieldId("category")}
                  name="category"
                  value={values.category}
                  onChange={(event) => set("category", event.target.value as ProspectCategory | "", "category")}
                  disabled={pending}
                  {...errorProps("category")}
                  className={selectClass}
                >
                  <option value="">{COPY.chooseCategory}</option>
                  {PROSPECT_CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {PROSPECT_CATEGORY_LABELS[category]}
                    </option>
                  ))}
                </select>
              </SelectBox>
            </Field>
          </div>

          {/* Lokasi: after Kategori in one column; the right column from 1280 px. */}
          <section
            aria-labelledby={fieldId("location-heading")}
            className="flex flex-col gap-3 border-t border-border pt-4 xl:col-start-2 xl:row-span-5 xl:row-start-1 xl:self-start xl:border-0 xl:pt-0"
          >
            <h2 id={fieldId("location-heading")} className="text-base font-semibold">
              {COPY.location}
            </h2>
            <Button
              ref={(element: HTMLButtonElement | null) => {
                fieldRefs.current.location = element;
              }}
              type="button"
              variant="outline"
              onClick={locateMe}
              disabled={gps === "locating" || pending}
              aria-describedby={fieldErrors.location ? `${fieldId("location")}-error` : undefined}
              className={cn(actionClass, "w-full gap-2 disabled:cursor-progress")}
            >
              <LocateFixed aria-hidden className="size-5" />
              {gps === "locating" ? COPY.locating : COPY.useMyLocation}
            </Button>
            <p role="status" className="empty:hidden flex items-start gap-2 text-sm">
              {(gps === "denied" || gps === "failed") && (
                <>
                  <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
                  {gps === "denied" ? COPY.gpsDenied : COPY.gpsFailed}
                </>
              )}
            </p>

            <div
              data-testid="location-map"
              className={cn(
                "relative isolate z-0 h-50 overflow-hidden rounded-lg border border-border bg-muted xl:h-90",
                fieldErrors.location && "border-danger",
              )}
            >
              <LocationPickerMap
                value={values.location}
                recenterKey={recenterKey}
                onPick={pickOnMap}
                label={COPY.mapLabel}
              />
            </div>

            <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-3">
              <p data-testid="location-line" className="text-sm tabular-nums">
                {values.location ? formatLocation(values.location) : <span className="text-muted-foreground">{COPY.noLocation}</span>}
              </p>
              {values.location && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setLocation(null, false)}
                  disabled={pending}
                  className="-mr-2 h-11 px-2 text-base text-primary lg:h-9 lg:text-sm"
                >
                  {COPY.clearLocation}
                </Button>
              )}
            </div>
            {fieldErrors.location && <FieldError id={`${fieldId("location")}-error`}>{fieldErrors.location}</FieldError>}

            <details className="group">
              <summary className="flex min-h-11 w-fit cursor-pointer list-none items-center gap-1 rounded-lg text-base font-medium text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring lg:text-sm [&::-webkit-details-marker]:hidden">
                {COPY.enterCoordinates}
                <ChevronDown aria-hidden className="size-4 transition-transform group-open:rotate-180" />
              </summary>
              <div className="grid grid-cols-2 gap-3 pt-2">
                <Field id={fieldId("lat")} label={COPY.latitude}>
                  <Input
                    id={fieldId("lat")}
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="-6.4817"
                    value={latText}
                    onChange={(event) => onCoordinateChange(event.target.value, lngText)}
                    onBlur={() => values.location && setRecenterKey((key) => key + 1)}
                    readOnly={pending}
                    {...errorProps("location")}
                    className={cn(inputClass, "tabular-nums")}
                  />
                </Field>
                <Field id={fieldId("lng")} label={COPY.longitude}>
                  <Input
                    id={fieldId("lng")}
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="106.8540"
                    value={lngText}
                    onChange={(event) => onCoordinateChange(latText, event.target.value)}
                    onBlur={() => values.location && setRecenterKey((key) => key + 1)}
                    readOnly={pending}
                    {...errorProps("location")}
                    className={cn(inputClass, "tabular-nums")}
                  />
                </Field>
              </div>
            </details>
          </section>

          <div className="xl:col-start-1">
            <Field id={fieldId("address")} label={COPY.address} error={fieldErrors.address}>
              <Input
                ref={(element) => {
                  fieldRefs.current.address = element;
                }}
                id={fieldId("address")}
                name="address"
                autoComplete="off"
                value={values.address}
                onChange={(event) => set("address", event.target.value, "address")}
                readOnly={pending}
                {...errorProps("address")}
                className={inputClass}
              />
            </Field>
          </div>

          <section
            aria-labelledby={fieldId("contact-heading")}
            className="flex flex-col gap-5 border-t border-border pt-4 xl:col-start-1"
          >
            <h2 id={fieldId("contact-heading")} className="text-base font-semibold">
              {COPY.contact}
            </h2>
            <Field id={fieldId("contact.name")} label={COPY.contactName} error={fieldErrors["contact.name"]}>
              <Input
                ref={(element) => {
                  fieldRefs.current["contact.name"] = element;
                }}
                id={fieldId("contact.name")}
                name="contactName"
                autoComplete="off"
                value={values.contactName}
                onChange={(event) => set("contactName", event.target.value, "contact.name")}
                readOnly={pending}
                {...errorProps("contact.name")}
                className={inputClass}
              />
            </Field>
            <Field id={fieldId("contact.role")} label={COPY.contactRole} error={fieldErrors["contact.role"]}>
              <Input
                ref={(element) => {
                  fieldRefs.current["contact.role"] = element;
                }}
                id={fieldId("contact.role")}
                name="contactRole"
                autoComplete="off"
                value={values.contactRole}
                onChange={(event) => set("contactRole", event.target.value, "contact.role")}
                readOnly={pending}
                {...errorProps("contact.role")}
                className={inputClass}
              />
            </Field>
            <Field id={fieldId("contact.phone")} label={COPY.contactPhone} error={fieldErrors["contact.phone"]}>
              <Input
                ref={(element) => {
                  fieldRefs.current["contact.phone"] = element;
                }}
                id={fieldId("contact.phone")}
                name="contactPhone"
                type="tel"
                inputMode="tel"
                autoComplete="off"
                value={values.contactPhone}
                onChange={(event) => set("contactPhone", event.target.value, "contact.phone")}
                readOnly={pending}
                {...errorProps("contact.phone")}
                className={cn(inputClass, "tabular-nums")}
              />
            </Field>
          </section>

          <div className="flex flex-col gap-5 border-t border-border pt-4 xl:col-start-1">
            <Field id={fieldId("potentialAccounts")} label={COPY.potentialAccounts} error={fieldErrors.potentialAccounts}>
              <Input
                ref={(element) => {
                  fieldRefs.current.potentialAccounts = element;
                }}
                id={fieldId("potentialAccounts")}
                name="potentialAccounts"
                inputMode="numeric"
                autoComplete="off"
                value={values.potentialAccounts}
                onChange={(event) => set("potentialAccounts", event.target.value, "potentialAccounts")}
                readOnly={pending}
                {...errorProps("potentialAccounts")}
                className={cn(inputClass, "tabular-nums")}
              />
            </Field>

            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <Label htmlFor={fieldId("note")} className="text-base leading-6">
                  {COPY.note}
                </Label>
                <span
                  id={`${fieldId("note")}-count`}
                  className={cn(
                    "text-sm tabular-nums text-muted-foreground",
                    noteCount >= FREE_TEXT_MAX && "font-medium text-foreground",
                  )}
                >
                  {noteCount}/{FREE_TEXT_MAX}
                </span>
              </div>
              <Textarea
                ref={(element) => {
                  fieldRefs.current.note = element;
                }}
                id={fieldId("note")}
                name="note"
                rows={4}
                value={values.note}
                onChange={(event) => set("note", limitCharacters(event.target.value), "note")}
                readOnly={pending}
                aria-invalid={fieldErrors.note ? true : undefined}
                aria-describedby={cn(
                  fieldErrors.note && `${fieldId("note")}-error`,
                  `${fieldId("note")}-hint`,
                  `${fieldId("note")}-count`,
                )}
                className="min-h-28 px-3 py-2.5 text-base md:text-base read-only:cursor-progress"
              />
              {fieldErrors.note && <FieldError id={`${fieldId("note")}-error`}>{fieldErrors.note}</FieldError>}
              <p id={`${fieldId("note")}-hint`} className="text-sm text-muted-foreground">
                {COPY.noteHint}
              </p>
            </div>
          </div>
        </div>
      </fieldset>

      {/* Below 1024 px the actions stay in thumb reach, just above the bottom navigation. */}
      {!duplicates && (
        <div className="sticky bottom-[calc(var(--bottom-nav-height)+env(safe-area-inset-bottom))] z-20 -mx-4 -mb-4 border-t border-border bg-background px-4 py-3 lg:static lg:mx-0 lg:mb-0 lg:border-0 lg:px-0 lg:py-0">
          <div className="flex gap-3">
            <Button
              type="submit"
              disabled={locked}
              className={cn(actionClass, "flex-1 disabled:cursor-progress lg:flex-none lg:px-6")}
            >
              {pending ? COPY.saving : COPY.save}
            </Button>
            <Link
              href={backHref}
              className={cn(buttonVariants({ variant: "outline" }), actionClass, "hidden lg:inline-flex")}
            >
              {COPY.cancel}
            </Link>
          </div>
        </div>
      )}
    </form>
  );
}

function DuplicateWarning({
  ref,
  state,
  discarding,
  discardError,
  onKeep,
  onDiscard,
  onRename,
}: {
  ref: React.Ref<HTMLDivElement>;
  state: DuplicateState;
  discarding: boolean;
  discardError: boolean;
  onKeep: () => void;
  onDiscard: () => void;
  onRename: () => void;
}) {
  const created = state.mode === "created";
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="alert"
      data-testid="duplicate-warning"
      className="flex scroll-mt-20 gap-3 rounded-lg border border-warning/60 bg-warning/5 p-3 outline-none lg:scroll-mt-6"
    >
      <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-warning" />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-base font-semibold break-words">{COPY.duplicateTitle(state.prospect.name)}</p>
          <p className="text-base">{created ? COPY.duplicateCreated : COPY.duplicateUpdated}</p>
        </div>
        <ul className="flex flex-col">
          {state.duplicates.map((duplicate) => (
            <li key={duplicate.id}>
              <Link
                href={prospectPath(duplicate.id)}
                className="inline-flex min-h-11 items-center text-base font-medium break-words text-primary underline underline-offset-4 lg:min-h-9"
              >
                {COPY.duplicateOpen(duplicate.name)}
              </Link>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button type="button" onClick={onKeep} disabled={discarding} className={actionClass}>
            {COPY.keepBoth}
          </Button>
          {created ? (
            <Button type="button" variant="outline" onClick={onDiscard} disabled={discarding} className={cn(actionClass, "disabled:cursor-progress")}>
              {COPY.discardNew}
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={onRename} className={actionClass}>
              {COPY.renameAgain}
            </Button>
          )}
        </div>
        {created && <p className="text-sm text-muted-foreground">{COPY.discardNewHint}</p>}
        {discardError && <p className="text-sm text-danger">{COPY.discardFailed}</p>}
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  required = false,
  error,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Label htmlFor={id} className="text-base leading-6">
        {label}
        {required && <span aria-hidden> *</span>}
      </Label>
      {children}
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </div>
  );
}

function SelectBox({ children }: { children: ReactNode }) {
  return (
    <div className="relative">
      {children}
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-3 size-5 -translate-y-1/2 text-muted-foreground"
      />
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

/** The edit page's loading state: the form's shape, without values. */
function FormSkeleton() {
  return (
    <div aria-busy className="flex w-full max-w-160 flex-col gap-5 xl:max-w-240">
      <span className="sr-only">{COPY.loading}</span>
      <div aria-hidden className="grid grid-cols-1 gap-5 xl:grid-cols-2 xl:gap-x-10">
        <div className="flex flex-col gap-5">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="flex flex-col gap-2">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-12 w-full lg:h-10" />
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-50 w-full xl:h-90" />
        </div>
      </div>
    </div>
  );
}
