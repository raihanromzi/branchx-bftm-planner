// Pure helpers for the Prospect form (E2-S3): the form's string state, its mapping to the API bodies
// (api.md, Prospects), the inline checks with the shared zod rules, and the coordinate line.
import { formatNumber, formatPhone } from "@/lib/format";
import {
  createProspectInput,
  FREE_TEXT_MAX,
  INVALID_MESSAGE,
  POTENTIAL_ACCOUNTS_MESSAGE,
  type ProspectCategory,
  REQUIRED_MESSAGE,
} from "@/lib/validation";

/** A location on the form. `accuracy` (metres) is known only when it came from GPS. */
export type FormLocation = { lat: number; lng: number; accuracy: number | null };

/** What the Admin typed, as strings, so every input keeps exactly what was entered. */
export type ProspectFormValues = {
  name: string;
  fundingOfficerId: string;
  /** "" when no Category is picked. */
  category: ProspectCategory | "";
  address: string;
  location: FormLocation | null;
  contactName: string;
  contactRole: string;
  contactPhone: string;
  potentialAccounts: string;
  note: string;
};

export const EMPTY_FORM: ProspectFormValues = {
  name: "",
  fundingOfficerId: "",
  category: "",
  address: "",
  location: null,
  contactName: "",
  contactRole: "",
  contactPhone: "",
  potentialAccounts: "",
  note: "",
};

/** A Prospect record as GET /api/prospects/:id returns it (api.md, "The record"). */
export type ProspectRecord = {
  id: string;
  name: string;
  category: ProspectCategory | null;
  address: string | null;
  location: { lat: number; lng: number } | null;
  contact: { name: string | null; role: string | null; phone: string | null };
  potentialAccounts: number | null;
  fundingOfficer: { id: string; name: string; active: boolean };
  note: string | null;
  archived: boolean;
  archivedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** A create or update answer (api.md, Matching names). */
export type ProspectSaveResult = { prospect: ProspectRecord; duplicates: { id: string; name: string }[] };

/** The form's values for a loaded Prospect (edit). The phone is shown the way people dial it. */
export function valuesFromRecord(record: ProspectRecord): ProspectFormValues {
  return {
    name: record.name,
    fundingOfficerId: record.fundingOfficer.id,
    category: record.category ?? "",
    address: record.address ?? "",
    location: record.location ? { ...record.location, accuracy: null } : null,
    contactName: record.contact.name ?? "",
    contactRole: record.contact.role ?? "",
    contactPhone: record.contact.phone ? formatPhone(record.contact.phone) : "",
    potentialAccounts: record.potentialAccounts === null ? "" : String(record.potentialAccounts),
    note: record.note ?? "",
  };
}

/**
 * Potential Accounts as typed: blank is null, whole numbers (with "." thousand separators, "1.250") are
 * numbers, and anything else is "invalid" (EC10).
 */
export function parsePotentialAccounts(text: string): number | null | "invalid" {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (/^\d{1,3}(\.\d{3})+$/.test(trimmed)) return Number(trimmed.replaceAll(".", ""));
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  return "invalid";
}

/** The JSON body for POST /api/prospects, and (with `version`) for PATCH /api/prospects/:id. */
export function toApiBody(values: ProspectFormValues) {
  const potential = parsePotentialAccounts(values.potentialAccounts);
  return {
    name: values.name,
    category: values.category === "" ? null : values.category,
    fundingOfficerId: values.fundingOfficerId,
    address: values.address,
    location: values.location ? { lat: values.location.lat, lng: values.location.lng } : null,
    contact: { name: values.contactName, role: values.contactRole, phone: values.contactPhone },
    potentialAccounts: potential === "invalid" ? null : potential,
    note: values.note,
  };
}

export type FieldErrors = Partial<Record<FieldKey, string>>;

/** The error keys the API uses (field paths joined with "."), in the order the form shows them. */
export const FIELD_ORDER = [
  "name",
  "fundingOfficerId",
  "category",
  "location",
  "address",
  "contact.name",
  "contact.role",
  "contact.phone",
  "potentialAccounts",
  "note",
] as const;
export type FieldKey = (typeof FIELD_ORDER)[number];

/** Folds the API's error keys onto the form's: "location.lat" and "location.lng" show under the map. */
export function toFieldErrors(fields: Record<string, string | undefined> | undefined): FieldErrors {
  const errors: FieldErrors = {};
  for (const [key, message] of Object.entries(fields ?? {})) {
    if (!message) continue;
    const field = (key.startsWith("location") ? "location" : key) as FieldKey;
    if ((FIELD_ORDER as readonly string[]).includes(field) && !errors[field]) errors[field] = message;
  }
  return errors;
}

/** The first field with an error, in the form's order: focus moves there (EC9). */
export function firstErrorField(errors: FieldErrors): FieldKey | null {
  return FIELD_ORDER.find((field) => errors[field]) ?? null;
}

/**
 * The same checks the server applies (the shared zod rule), run before sending. An empty result means the
 * body can be sent. Potential Accounts that is not a whole number never reaches the body, so it is checked here.
 */
export function validateValues(values: ProspectFormValues, coordinateError: string | null = null): FieldErrors {
  const result = createProspectInput.safeParse(toApiBody(values));
  const errors = result.success
    ? {}
    : toFieldErrors(Object.fromEntries(result.error.issues.map((issue) => [issue.path.join("."), issue.message])));
  if (parsePotentialAccounts(values.potentialAccounts) === "invalid") errors.potentialAccounts = POTENTIAL_ACCOUNTS_MESSAGE;
  if (coordinateError) errors.location = coordinateError;
  return errors;
}

/** A typed coordinate: "-6.4817", "-6,4817" or "106.854". Blank is null; anything else is NaN. */
export function parseCoordinate(text: string): number | null {
  const trimmed = text.trim().replace(/^−/, "-");
  if (trimmed === "") return null;
  const normalized = trimmed.includes(".") ? trimmed : trimmed.replace(",", ".");
  return /^[-+]?\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : Number.NaN;
}

/**
 * The two "Masukkan koordinat" inputs as a location. Both blank is no location; one blank or a value that
 * is not a number is an error message for the map's field.
 */
export function coordinatesToLocation(
  latText: string,
  lngText: string,
): { location: FormLocation | null; error: string | null } {
  const lat = parseCoordinate(latText);
  const lng = parseCoordinate(lngText);
  if (lat === null && lng === null) return { location: null, error: null };
  if (lat === null || lng === null) return { location: null, error: REQUIRED_MESSAGE };
  if (Number.isNaN(lat) || Number.isNaN(lng)) return { location: null, error: INVALID_MESSAGE };
  return { location: { lat, lng, accuracy: null }, error: null };
}

/** A coordinate for the inputs: up to 6 decimals (about 10 cm), without trailing zeros. */
export function coordinateText(value: number): string {
  return String(Number(value.toFixed(6)));
}

/** The line under the map: "-6.4817, 106.8540 (±12 m)". The accuracy is shown only for a GPS fix. */
export function formatLocation(location: FormLocation): string {
  const coordinates = `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}`;
  return location.accuracy === null ? coordinates : `${coordinates} (±${formatNumber(Math.round(location.accuracy))} m)`;
}

/** Characters as the server counts them: an emoji counts once. */
export function characterCount(text: string): number {
  return [...text].length;
}

/** Cuts text to at most `max` characters (counted as the server counts them), so the note stops at 500. */
export function limitCharacters(text: string, max = FREE_TEXT_MAX): string {
  const characters = [...text];
  return characters.length <= max ? text : characters.slice(0, max).join("");
}
