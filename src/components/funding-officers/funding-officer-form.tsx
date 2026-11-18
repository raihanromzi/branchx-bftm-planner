"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { apiRequest } from "@/lib/api-client";
import { formatPhone } from "@/lib/format";
import { createFundingOfficerInput } from "@/lib/validation";
import { FO_COPY, FUNDING_OFFICERS_PATH, type FundingOfficer, InlineAlert } from "./shared";

type FieldErrors = { name?: string; phone?: string };
type FormAlert = { message: string; reload: boolean; id: number };

type FormProps = {
  /** The Funding Officer to edit, or null to add one. */
  officer: FundingOfficer | null;
  onSaved: (record: FundingOfficer) => void;
  onClose: () => void;
  onUnauthorized: () => void;
  /** Reloads the list and returns the latest version of a Funding Officer, or null when it is gone. */
  loadLatest: (id: string) => Promise<FundingOfficer | null>;
};

/**
 * Add or edit a Funding Officer: a bottom sheet on mobile, a dialog from 768 px. The parent gives it a new
 * `key` every time it opens, so each open starts clean with its own Idempotency-Key (EC15).
 */
export function FundingOfficerFormDialog({ open, ...props }: FormProps & { open: boolean }) {
  return (
    <ResponsiveDialog open={open} onOpenChange={(next) => !next && props.onClose()}>
      <ResponsiveDialogContent>
        <FundingOfficerForm {...props} />
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function FundingOfficerForm({ officer, onSaved, onClose, onUnauthorized, loadLatest }: FormProps) {
  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(officer?.name ?? "");
  const [phone, setPhone] = useState(officer ? formatPhone(officer.phone) : "");
  const [version, setVersion] = useState(officer?.version ?? 0);
  // One key per form open, reused on every retry of this submission (api.md, Idempotent creates).
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [pending, setPending] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [alert, setAlert] = useState<FormAlert | null>(null);

  function showAlert(message: string, reload = false) {
    // A new id re-mounts the alert, so a repeated message is announced again.
    setAlert((previous) => ({ message, reload, id: (previous?.id ?? 0) + 1 }));
  }

  // Inline check on leaving a filled field, with the same rule the server applies.
  function checkField(field: keyof FieldErrors, value: string) {
    if (!value.trim()) return;
    const result = createFundingOfficerInput.shape[field].safeParse(value);
    setFieldErrors((errors) => ({ ...errors, [field]: result.success ? undefined : result.error.issues[0]?.message }));
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setAlert(null);

    const result = officer
      ? await apiRequest<FundingOfficer>(`${FUNDING_OFFICERS_PATH}/${officer.id}`, {
          method: "PATCH",
          body: { name, phone, version },
        })
      : await apiRequest<FundingOfficer>(FUNDING_OFFICERS_PATH, {
          method: "POST",
          body: { name, phone },
          idempotencyKey,
        });

    if (result.ok) {
      // Stay disabled while the form closes.
      onSaved(result.data);
      return;
    }
    setPending(false);
    if (result.status === 401) return onUnauthorized();

    const fields = result.error.fields;
    if (result.status === 400 && (fields?.name || fields?.phone)) {
      setFieldErrors({ name: fields.name, phone: fields.phone });
      (fields.name ? nameRef : phoneRef).current?.focus();
      return;
    }
    // EC18: the record changed (409) or is gone (404) since it was loaded.
    showAlert(result.error.message, result.status === 409 || result.status === 404);
  }

  async function reload() {
    if (!officer) return;
    setReloading(true);
    const latest = await loadLatest(officer.id);
    setReloading(false);
    if (!latest) return onClose();
    setName(latest.name);
    setPhone(formatPhone(latest.phone));
    setVersion(latest.version);
    setFieldErrors({});
    setAlert(null);
    nameRef.current?.focus();
  }

  return (
    <form noValidate onSubmit={onSubmit} aria-busy={pending} className="flex flex-col gap-5">
      <ResponsiveDialogTitle>{officer ? FO_COPY.editTitle : FO_COPY.add}</ResponsiveDialogTitle>

      <div className="flex flex-col gap-2">
        <Label htmlFor="fo-name" className="text-base leading-6">
          {FO_COPY.name}
        </Label>
        <Input
          ref={nameRef}
          id="fo-name"
          name="name"
          autoComplete="off"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setFieldErrors((errors) => ({ ...errors, name: undefined }));
          }}
          onBlur={(event) => checkField("name", event.target.value)}
          readOnly={pending}
          aria-invalid={fieldErrors.name ? true : undefined}
          aria-describedby={fieldErrors.name ? "fo-name-error" : undefined}
          className="h-12 px-3 text-base md:text-base read-only:cursor-progress"
        />
        {fieldErrors.name && <FieldError id="fo-name-error">{fieldErrors.name}</FieldError>}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="fo-phone" className="text-base leading-6">
          {FO_COPY.phone}
        </Label>
        <Input
          ref={phoneRef}
          id="fo-phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="off"
          value={phone}
          onChange={(event) => {
            setPhone(event.target.value);
            setFieldErrors((errors) => ({ ...errors, phone: undefined }));
          }}
          onBlur={(event) => checkField("phone", event.target.value)}
          readOnly={pending}
          aria-invalid={fieldErrors.phone ? true : undefined}
          aria-describedby={fieldErrors.phone ? "fo-phone-error" : undefined}
          className="h-12 px-3 text-base tabular-nums md:text-base read-only:cursor-progress"
        />
        {fieldErrors.phone && <FieldError id="fo-phone-error">{fieldErrors.phone}</FieldError>}
      </div>

      {alert && (
        <InlineAlert
          key={alert.id}
          message={alert.message}
          action={
            alert.reload && (
              <Button
                type="button"
                variant="outline"
                onClick={reload}
                disabled={reloading}
                className="h-11 px-4 text-base lg:h-9 lg:text-sm"
              >
                {FO_COPY.reload}
              </Button>
            )
          }
        />
      )}

      <ResponsiveDialogFooter>
        <ResponsiveDialogClose
          render={<Button type="button" variant="outline" className="h-11 px-4 text-base lg:h-9 lg:text-sm" />}
        >
          {FO_COPY.cancel}
        </ResponsiveDialogClose>
        <Button
          type="submit"
          disabled={pending}
          className="h-11 px-4 text-base disabled:cursor-progress lg:h-9 lg:text-sm"
        >
          {FO_COPY.save}
        </Button>
      </ResponsiveDialogFooter>
    </form>
  );
}

function FieldError({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} className="text-sm text-danger">
      {children}
    </p>
  );
}
