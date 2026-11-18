// Shared input rules for every form (E0-S6). Pure TypeScript with zod, safe in client components,
// so forms can show the same messages inline. The server always validates again (ADR 0003).
import { z } from "zod";

export const PHONE_MESSAGE = "Nomor telepon tidak valid. Contoh: 0812 3456 7890";
export const CUSTOMER_NUMBER_MESSAGE = "Jangan tulis NIK atau nomor rekening nasabah.";
export const REQUIRED_MESSAGE = "Wajib diisi.";
export const INVALID_MESSAGE = "Isian tidak valid.";
export const VERSION_CONFLICT_MESSAGE = "Data ini sudah diubah. Muat ulang untuk melihat versi terbaru.";
export const FREE_TEXT_MAX = 500;

export const maxLengthMessage = (max: number) => `Maksimal ${max} karakter.`;

/**
 * Default messages in Bahasa Indonesia for any rule without its own message: "Wajib diisi." when a
 * value is missing, "Isian tidak valid." otherwise. Messages set on a schema still win.
 */
z.config({
  customError: (issue) =>
    issue.code === "invalid_type" && issue.input === undefined ? REQUIRED_MESSAGE : INVALID_MESSAGE,
});

/**
 * Normalises an Indonesian phone number to "+62…", or returns null when it is not valid.
 * Accepts "08…", "628…" or "+62…", with spaces, dots or dashes anywhere. After the country code
 * there must be 9 to 13 digits, and the first of them must not be a trunk "0".
 */
export function normalizePhone(input: string): string | null {
  const compact = input.trim().replace(/[\s.\-]/g, "");
  const match = /^(?:\+62|62|0)(\d+)$/.exec(compact);
  if (!match) return null;
  const national = match[1];
  if (national.length < 9 || national.length > 13 || national.startsWith("0")) return null;
  return `+62${national}`;
}

/**
 * The customer-data guard (ADR 0001, EC42). A "digit run" is digits joined across up to three
 * spaces, dots or dashes on one line, such as "3201 2345 6789 0001" or "3201 - 2345". The text is
 * rejected when a run has 16 or more digits (a NIK), or 10 or more digits and is not a valid phone
 * number by normalizePhone (an account number). Shorter runs, such as "350 rekening" or "Blok B 12",
 * are allowed. Numeric dates with a four-digit year ("18-11-2026", "2026-11-18") are removed first,
 * so a field note such as "Kunjungan 18-11-2026 10.30" is not read as one long number.
 */
const NUMERIC_DATE = /\b(?:\d{1,2}[.\-]\d{1,2}[.\-]\d{4}|\d{4}-\d{1,2}-\d{1,2})\b/g;

export function containsCustomerNumber(text: string): boolean {
  const withoutDates = text.replace(NUMERIC_DATE, " | ");
  for (const [run] of withoutDates.matchAll(/\d(?:[ \t.\-]{0,3}\d)*/g)) {
    const digits = run.replace(/\D/g, "");
    if (digits.length >= 16) return true;
    if (digits.length >= 10 && normalizePhone(digits) === null) return true;
  }
  return false;
}

/** A required phone number, output as "+62…". */
export const phone = z.string().transform((value, ctx) => {
  const normalized = normalizePhone(value);
  if (normalized === null) {
    ctx.addIssue({ code: "custom", message: PHONE_MESSAGE });
    return z.NEVER;
  }
  return normalized;
});

function textRules(schema: z.ZodString, max: number) {
  return schema
    .refine((value) => [...value].length <= max, { error: maxLengthMessage(max), abort: true })
    .refine((value) => !containsCustomerNumber(value), { error: CUSTOMER_NUMBER_MESSAGE });
}

/**
 * Required free text: trimmed, not empty, at most `max` characters (default 500), no NIK or account numbers.
 * `requiredMessage` replaces "Wajib diisi." when the value is missing or blank.
 */
export function freeText({ max = FREE_TEXT_MAX, requiredMessage = REQUIRED_MESSAGE }: { max?: number; requiredMessage?: string } = {}) {
  const base = z.string({ error: (issue) => (issue.input === undefined ? requiredMessage : INVALID_MESSAGE) });
  return textRules(base.trim().min(1, { error: requiredMessage }), max);
}

/** Optional free text: same rules; missing, null or blank becomes null. */
export function optionalFreeText({ max = FREE_TEXT_MAX }: { max?: number } = {}) {
  return textRules(z.string().trim(), max)
    .nullish()
    .transform((value) => (value ? value : null));
}

/** The `version` an update sends back: the version the client loaded (ADR 0003). */
export const version = z.number().int().min(1);

export const EMAIL_FORMAT_MESSAGE = "Format email tidak valid.";
/** Longest email (RFC 5321) and password accepted at sign-in. */
export const SIGN_IN_EMAIL_MAX = 254;
export const SIGN_IN_PASSWORD_MAX = 200;

/**
 * The sign-in form (E0-S3). The email is trimmed and lower-cased; the password is taken as typed.
 * A malformed email is a validation error, which reveals nothing about which emails exist.
 */
export const signInInput = z.object({
  email: z
    .string()
    .trim()
    .min(1, { error: REQUIRED_MESSAGE })
    .max(SIGN_IN_EMAIL_MAX, { error: maxLengthMessage(SIGN_IN_EMAIL_MAX) })
    .pipe(z.email({ error: EMAIL_FORMAT_MESSAGE }))
    .transform((value) => value.toLowerCase()),
  password: z
    .string()
    .min(1, { error: REQUIRED_MESSAGE })
    .max(SIGN_IN_PASSWORD_MAX, { error: maxLengthMessage(SIGN_IN_PASSWORD_MAX) }),
});

/** Longest Funding Officer name (E1-S1). */
export const FUNDING_OFFICER_NAME_MAX = 100;

/** A Funding Officer's name: required, trimmed, 1 to 100 characters, with the shared free-text rules. */
const fundingOfficerName = freeText({ max: FUNDING_OFFICER_NAME_MAX });

/** Adding a Funding Officer (E1-S1). A new Funding Officer is always active; `active` is not accepted. */
export const createFundingOfficerInput = z.object({
  name: fundingOfficerName,
  phone,
});

/** Editing a Funding Officer (E1-S1): any of name and phone, with the version the client loaded. */
export const updateFundingOfficerInput = z.object({
  name: fundingOfficerName.optional(),
  phone: phone.optional(),
  version,
});

/** Deactivating or reactivating a Funding Officer (E1-S1): only the version the client loaded. */
export const fundingOfficerStatusInput = z.object({ version });

/** An optional phone number: missing, null or blank becomes null; otherwise output as "+62…". */
export const optionalPhone = z
  .string()
  .nullish()
  .transform((value, ctx) => {
    if (value === null || value === undefined || value.trim() === "") return null;
    const normalized = normalizePhone(value);
    if (normalized === null) {
      ctx.addIssue({ code: "custom", message: PHONE_MESSAGE });
      return z.NEVER;
    }
    return normalized;
  });

// Prospects (E2-S1). A Prospect is an institution or venue, never an account holder (ADR 0001).

/** Longest Prospect name (E2-S1 criterion 1, EC7). */
export const PROSPECT_NAME_MAX = 150;
/** Longest Contact Person name and role. */
export const CONTACT_TEXT_MAX = 100;
/** Potential Accounts range (E2-S1 criterion 2, EC10). */
export const POTENTIAL_ACCOUNTS_MAX = 100_000;
/** Indonesia's bounding box (E2-S1 criterion 3, EC13). Inclusive. */
export const INDONESIA_BOUNDS = { minLat: -11, maxLat: 6, minLng: 95, maxLng: 141 } as const;

export const PROSPECT_NAME_REQUIRED_MESSAGE = "Nama Prospect wajib diisi.";
export const POTENTIAL_ACCOUNTS_MESSAGE = "Potensi rekening harus bilangan bulat 0 sampai 100.000.";
export const LOCATION_OUTSIDE_INDONESIA_MESSAGE = "Lokasi di luar Indonesia.";

/** The Category values the API sends and accepts, with their UI labels. */
export const PROSPECT_CATEGORIES = ["sekolah", "pasar", "perusahaan", "instansi", "komunitas", "lainnya"] as const;
export type ProspectCategory = (typeof PROSPECT_CATEGORIES)[number];
export const PROSPECT_CATEGORY_LABELS: Record<ProspectCategory, string> = {
  sekolah: "Sekolah",
  pasar: "Pasar",
  perusahaan: "Perusahaan",
  instansi: "Instansi",
  komunitas: "Komunitas",
  lainnya: "Lainnya",
};

/**
 * The key two Prospect names are compared by (EC14) and searched on: trimmed, runs of whitespace
 * collapsed to one space, lower-cased. "SDN  3 Cibinong " and "sdn 3 cibinong" share a key.
 */
export function prospectNameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

const prospectName = freeText({ max: PROSPECT_NAME_MAX, requiredMessage: PROSPECT_NAME_REQUIRED_MESSAGE });
const prospectCategory = z.enum(PROSPECT_CATEGORIES, {
  error: (issue) => (issue.input === undefined ? REQUIRED_MESSAGE : INVALID_MESSAGE),
});
const fundingOfficerId = z.string().trim().min(1, { error: REQUIRED_MESSAGE });

/** A location: both latitude and longitude, inside Indonesia's bounding box. */
export const prospectLocation = z
  .object({ lat: z.number(), lng: z.number() })
  .refine(
    ({ lat, lng }) =>
      lat >= INDONESIA_BOUNDS.minLat &&
      lat <= INDONESIA_BOUNDS.maxLat &&
      lng >= INDONESIA_BOUNDS.minLng &&
      lng <= INDONESIA_BOUNDS.maxLng,
    { error: LOCATION_OUTSIDE_INDONESIA_MESSAGE },
  );

/** The Contact Person: each of name, role and phone is optional. Unknown keys are dropped. */
export const prospectContact = z.object({
  name: optionalFreeText({ max: CONTACT_TEXT_MAX }),
  role: optionalFreeText({ max: CONTACT_TEXT_MAX }),
  phone: optionalPhone,
});

/** Potential Accounts: an integer from 0 to 100,000. */
export const potentialAccounts = z
  .number({ error: POTENTIAL_ACCOUNTS_MESSAGE })
  .int({ error: POTENTIAL_ACCOUNTS_MESSAGE })
  .min(0, { error: POTENTIAL_ACCOUNTS_MESSAGE })
  .max(POTENTIAL_ACCOUNTS_MAX, { error: POTENTIAL_ACCOUNTS_MESSAGE });

const nullContact = { name: null, role: null, phone: null };

/**
 * Adding a Prospect (E2-S1). Required: name and fundingOfficerId (docs/design/E2-S3.md). Everything
 * else, Category included, is optional and stored as null when missing. Unknown keys (such as an account holder's details) are dropped.
 */
export const createProspectInput = z.object({
  name: prospectName,
  category: prospectCategory.nullish().transform((value) => value ?? null),
  fundingOfficerId,
  address: optionalFreeText(),
  location: prospectLocation.nullish().transform((value) => value ?? null),
  contact: prospectContact.nullish().transform((value) => value ?? nullContact),
  potentialAccounts: potentialAccounts.nullish().transform((value) => value ?? null),
  note: optionalFreeText(),
});

/**
 * Editing a Prospect (E2-S1): any subset of the fields, with the version the client loaded. A field
 * left out is unchanged; null clears an optional field (location: null removes the location). A
 * `contact` object replaces all three Contact Person fields.
 */
export const updateProspectInput = z.object({
  name: prospectName.optional(),
  category: prospectCategory.nullable().optional(),
  fundingOfficerId: fundingOfficerId.optional(),
  address: optionalFreeText().optional(),
  location: prospectLocation.nullable().optional(),
  contact: prospectContact
    .nullable()
    .transform((value) => value ?? nullContact)
    .optional(),
  potentialAccounts: potentialAccounts.nullable().optional(),
  note: optionalFreeText().optional(),
  version,
});

/** Archiving or restoring a Prospect (E2-S1): only the version the client loaded. */
export const prospectStatusInput = z.object({ version });

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const flag = z.enum(["0", "1"]).default("0").transform((value) => value === "1");

/**
 * The query string of GET /api/prospects (E2-S1 criterion 4). Blank values count as missing.
 * archived=1 includes archived Prospects alongside the others; the default leaves them out.
 */
export const prospectListQuery = z.preprocess(
  (value) =>
    Object.fromEntries(
      Object.entries(value as Record<string, string>).filter(([, item]) => typeof item === "string" && item.trim() !== ""),
    ),
  z.object({
    q: z
      .string()
      .max(PROSPECT_NAME_MAX, { error: maxLengthMessage(PROSPECT_NAME_MAX) })
      .optional(),
    category: prospectCategory.optional(),
    fundingOfficerId: z.string().regex(UUID_PATTERN).optional(),
    archived: flag,
    noLocation: flag,
    page: z.coerce.number().int().min(1).max(100_000).default(1),
  }),
);

// Pipeline Templates (E3-S1). A template is a name and ordered Stages, each with ordered Task names.

/** Longest template name, Stage name and Task name, and the most Stages and Tasks per Stage (E3-S1, docs/design/E3-S2.md). */
export const PIPELINE_TEMPLATE_NAME_MAX = 100;
export const STAGE_NAME_MAX = 60;
export const TASK_NAME_MAX = 120;
export const STAGES_MAX = 30;
export const TASKS_PER_STAGE_MAX = 30;

export const PIPELINE_TEMPLATE_NAME_REQUIRED_MESSAGE = "Nama template wajib diisi.";
export const STAGES_REQUIRED_MESSAGE = "Tambahkan minimal satu Stage.";
export const STAGE_NAME_REQUIRED_MESSAGE = "Nama Tahap wajib diisi.";
export const TASK_NAME_REQUIRED_MESSAGE = "Nama Tugas wajib diisi.";
export const STAGES_MAX_MESSAGE = `Maksimal ${STAGES_MAX} Tahap.`;
export const TASKS_MAX_MESSAGE = `Maksimal ${TASKS_PER_STAGE_MAX} Tugas per Tahap.`;

/**
 * The key template names are compared by: trimmed, whitespace collapsed, lower-cased (the same rule
 * as prospectNameKey). Two active templates cannot share a key.
 */
export function pipelineTemplateNameKey(name: string): string {
  return prospectNameKey(name);
}

const pipelineTemplateName = freeText({
  max: PIPELINE_TEMPLATE_NAME_MAX,
  requiredMessage: PIPELINE_TEMPLATE_NAME_REQUIRED_MESSAGE,
});

/** A Task in a template: only its name. Its position is its index in the Stage's `tasks`. */
export const templateTaskInput = z.object({
  name: freeText({ max: TASK_NAME_MAX, requiredMessage: TASK_NAME_REQUIRED_MESSAGE }),
});

/** A Stage in a template: its name and its Tasks (zero or more, default none), in order. */
export const templateStageInput = z.object({
  name: freeText({ max: STAGE_NAME_MAX, requiredMessage: STAGE_NAME_REQUIRED_MESSAGE }),
  tasks: z
    .array(templateTaskInput)
    .max(TASKS_PER_STAGE_MAX, { error: TASKS_MAX_MESSAGE })
    .nullish()
    .transform((value) => value ?? []),
});

/** The Stages of a template, in order: 1 to 30. Missing or empty is "Tambahkan minimal satu Stage." (EC3). */
const templateStages = z
  .array(templateStageInput, {
    error: (issue) => (issue.input === undefined || issue.input === null ? STAGES_REQUIRED_MESSAGE : INVALID_MESSAGE),
  })
  .min(1, { error: STAGES_REQUIRED_MESSAGE })
  .max(STAGES_MAX, { error: STAGES_MAX_MESSAGE });

/**
 * Adding a Pipeline Template (E3-S1). Field errors are keyed by path: "name", "stages",
 * "stages.2.name", "stages.1.tasks", "stages.1.tasks.0.name" (indexes from 0). Unknown keys are dropped.
 */
export const createPipelineTemplateInput = z.object({
  name: pipelineTemplateName,
  stages: templateStages,
});

/** Saving a Pipeline Template (E3-S1): the whole template, replacing its name, Stages and Tasks, with the version the client loaded. */
export const updatePipelineTemplateInput = z.object({
  name: pipelineTemplateName,
  stages: templateStages,
  version,
});

/** Archiving or restoring a Pipeline Template (E3-S1): only the version the client loaded. */
export const pipelineTemplateStatusInput = z.object({ version });
