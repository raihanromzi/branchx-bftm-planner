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

/** Drops blank query parameters, so they count as missing. */
const blankAsMissing = (value: unknown) =>
  Object.fromEntries(
    Object.entries(value as Record<string, string>).filter(([, item]) => typeof item === "string" && item.trim() !== ""),
  );

/**
 * The Funding Officer and Stage filters, shared by the Prospect list and the map (E6-S1). The Stage
 * filter (E3-S3 criterion 9) is the open or On Hold Pipeline's template and current Stage position;
 * the two go together.
 */
const prospectFilterFields = {
  fundingOfficerId: z.string().regex(UUID_PATTERN).optional(),
  templateId: z.string().regex(UUID_PATTERN).optional(),
  stagePosition: z.coerce.number().int().min(1).max(30).optional(), // 30 = STAGES_MAX (declared below)
};

function requireStagePair(query: { templateId?: string; stagePosition?: number }, ctx: z.RefinementCtx) {
  if (query.templateId !== undefined && query.stagePosition === undefined) {
    ctx.addIssue({ code: "custom", path: ["stagePosition"], message: REQUIRED_MESSAGE });
  }
  if (query.stagePosition !== undefined && query.templateId === undefined) {
    ctx.addIssue({ code: "custom", path: ["templateId"], message: REQUIRED_MESSAGE });
  }
}

/**
 * The query string of GET /api/prospects (E2-S1 criterion 4). Blank values count as missing.
 * archived=1 includes archived Prospects alongside the others; the default leaves them out.
 */
export const prospectListQuery = z.preprocess(
  blankAsMissing,
  z
    .object({
      q: z
        .string()
        .max(PROSPECT_NAME_MAX, { error: maxLengthMessage(PROSPECT_NAME_MAX) })
        .optional(),
      category: prospectCategory.optional(),
      archived: flag,
      noLocation: flag,
      page: z.coerce.number().int().min(1).max(100_000).default(1),
      ...prospectFilterFields,
    })
    .superRefine(requireStagePair),
);

/** The query string of GET /api/map/prospects (E6-S1 criterion 2): the Funding Officer and Stage filters only. */
export const mapProspectQuery = z.preprocess(blankAsMissing, z.object(prospectFilterFields).superRefine(requireStagePair));

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

// Pipelines (E3-S3). A Pipeline copies its template's Stages and Tasks when it starts; its Outcome
// moves only along the transitions in api.md (Pipelines).

/** Accounts Opened range (E3-S3 criterion 5, EC10). */
export const ACCOUNTS_OPENED_MAX = 100_000;
export const ACCOUNTS_OPENED_MESSAGE = "Rekening dibuka harus bilangan bulat 1 sampai 100.000.";
export const WON_ON_FUTURE_MESSAGE = "Tanggal berhasil tidak boleh di masa depan.";
export const DATE_MESSAGE = "Tanggal tidak valid.";

/** The Outcome values the API sends: null is an open Pipeline. UI labels in PIPELINE_OUTCOME_LABELS. */
export const PIPELINE_OUTCOMES = ["won", "lost", "on_hold"] as const;
export type PipelineOutcome = (typeof PIPELINE_OUTCOMES)[number];
export const PIPELINE_OUTCOME_LABELS: Record<PipelineOutcome, string> = {
  won: "Berhasil",
  lost: "Gagal",
  on_hold: "Ditunda",
};

const WIB_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jakarta",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * The calendar day in WIB (Asia/Jakarta) as "YYYY-MM-DD". At 2026-01-31T17:30Z it is already
 * "2026-02-01" (00:30 WIB). Used for the Won date limit (EC32) and Overdue Tasks (EC30).
 */
export function wibDate(now: Date = new Date()): string {
  return WIB_DATE.format(now);
}

/** A calendar date "YYYY-MM-DD" that exists (no 30 February). */
export const calendarDate = z
  .string({ error: (issue) => (issue.input === undefined ? REQUIRED_MESSAGE : DATE_MESSAGE) })
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: DATE_MESSAGE, abort: true })
  .refine(
    (value) => {
      const date = new Date(`${value}T00:00:00Z`);
      return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
    },
    { error: DATE_MESSAGE },
  );

/** Accounts Opened: an integer from 1 to 100,000. */
export const accountsOpened = z
  .number({ error: ACCOUNTS_OPENED_MESSAGE })
  .int({ error: ACCOUNTS_OPENED_MESSAGE })
  .min(1, { error: ACCOUNTS_OPENED_MESSAGE })
  .max(ACCOUNTS_OPENED_MAX, { error: ACCOUNTS_OPENED_MESSAGE });

const requiredId = z.string({ error: (issue) => (issue.input === undefined ? REQUIRED_MESSAGE : INVALID_MESSAGE) }).trim().min(1, { error: REQUIRED_MESSAGE });

/** Starting a Pipeline (E3-S3 criterion 1): the Prospect and the template. Needs an Idempotency-Key. */
export const startPipelineInput = z.object({
  prospectId: requiredId,
  templateId: requiredId,
});

/** Moving a Pipeline to one of its Stages (E3-S3 criterion 3), by 1-based position. */
export const movePipelineInput = z.object({
  stagePosition: z.number().int().min(1),
  version,
});

/**
 * Setting the Outcome (E3-S3 criterion 5). "open" resumes an On Hold Pipeline. Won needs Accounts
 * Opened and the Won date ("YYYY-MM-DD"; the server also refuses a date after today in WIB, EC32);
 * Lost needs a reason (free text, the customer-number guard). Fields of other outcomes are ignored.
 */
export const pipelineOutcomeInput = z.discriminatedUnion(
  "outcome",
  [
    z.object({ outcome: z.literal("won"), accountsOpened, wonOn: calendarDate, version }),
    z.object({ outcome: z.literal("lost"), lostReason: freeText(), version }),
    z.object({ outcome: z.literal("on_hold"), version }),
    z.object({ outcome: z.literal("open"), version }),
  ],
  {
    // The discriminator's issue carries the whole body as its input.
    error: (issue) =>
      issue.input === undefined || (issue.input as { outcome?: unknown } | null)?.outcome === undefined
        ? REQUIRED_MESSAGE
        : INVALID_MESSAGE,
  },
);

/** Reopening a Won or Lost Pipeline (E3-S3 criterion 6): only the version the client loaded. */
export const pipelineStatusInput = z.object({ version });

/** Changing a Pipeline's own Funding Officer (E3-S3 criterion 7, EC26). */
export const changePipelineFundingOfficerInput = z.object({
  fundingOfficerId: requiredId,
  version,
});

/**
 * Editing one Task of a Pipeline (E3-S3 criterion 4): tick or untick (`done`), set or clear the due
 * date (`dueOn`, "YYYY-MM-DD" or null), with the Task's own version. A field left out is unchanged.
 */
export const updatePipelineTaskInput = z.object({
  done: z.boolean().optional(),
  dueOn: calendarDate.nullable().optional(),
  version,
});

/** The query string of GET /api/pipelines: the Prospect whose Pipelines to list. */
export const pipelineListQuery = z.object({
  prospectId: z
    .string({ error: (issue) => (issue.input === undefined ? REQUIRED_MESSAGE : INVALID_MESSAGE) })
    .regex(UUID_PATTERN),
});

// Activities (E4-S1). A field visit or meeting with a Prospect, for a Funding Officer, at a time
// stored in UTC. Statuses move only along the transitions in api.md (Activities).

/** The Activity status values the API sends. UI labels in ACTIVITY_STATUS_LABELS. */
export const ACTIVITY_STATUSES = ["scheduled", "done", "cancelled"] as const;
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];
export const ACTIVITY_STATUS_LABELS: Record<ActivityStatus, string> = {
  scheduled: "Terjadwal",
  done: "Selesai",
  cancelled: "Dibatalkan",
};
export const STARTS_AT_MESSAGE = "Tanggal dan jam tidak valid.";
export const DATE_RANGE_MESSAGE = "Tanggal akhir tidak boleh sebelum tanggal awal.";

/** An ISO 8601 date and time with a zone ("2026-11-20T09:00:00+07:00" or "…Z"), as a Date. */
export const activityStartsAt = z
  .string({ error: (issue) => (issue.input === undefined ? REQUIRED_MESSAGE : STARTS_AT_MESSAGE) })
  .pipe(z.iso.datetime({ offset: true, error: STARTS_AT_MESSAGE }))
  .transform((value) => new Date(value));

const optionalId = z
  .string()
  .trim()
  .nullish()
  .transform((value) => (value ? value : null));

/**
 * Scheduling an Activity (E4-S1 criterion 1). A time in the past is allowed (EC28). pipelineId is
 * optional (missing, null or blank is none). Needs an Idempotency-Key.
 */
export const createActivityInput = z.object({
  prospectId: requiredId,
  fundingOfficerId: requiredId,
  startsAt: activityStartsAt,
  pipelineId: optionalId,
  purpose: freeText(),
});

/** Cancelling an Activity (E4-S1 criterion 3): only the version the client loaded. */
export const activityStatusInput = z.object({ version });

/**
 * The query string of GET /api/activities (E4-S1 criterion 4): `from` and `to` are WIB calendar
 * days, both included. fundingOfficerId is optional. Blank values count as missing.
 */
export const activityListQuery = z.preprocess(
  (value) =>
    Object.fromEntries(
      Object.entries(value as Record<string, string>).filter(([, item]) => typeof item === "string" && item.trim() !== ""),
    ),
  z
    .object({
      from: calendarDate,
      to: calendarDate,
      fundingOfficerId: z.string().regex(UUID_PATTERN).optional(),
    })
    .refine((query) => query.to >= query.from, { path: ["to"], error: DATE_RANGE_MESSAGE }),
);

// Targets and the dashboard (E5-S1). A Target is a count of new accounts for a Funding Officer and a
// calendar month; Actual is computed from Won Pipelines, never entered.

/** Target range (E5-S1 criterion 1, EC10). */
export const TARGET_MAX = 100_000;
export const TARGET_MESSAGE = "Target harus bilangan bulat 0 sampai 100.000.";
export const MONTH_MESSAGE = "Bulan tidak valid.";

/** A calendar month "YYYY-MM" (years 2000 to 2099). */
export const calendarMonth = z
  .string({ error: (issue) => (issue.input === undefined ? REQUIRED_MESSAGE : MONTH_MESSAGE) })
  .regex(/^20\d{2}-(0[1-9]|1[0-2])$/, { error: MONTH_MESSAGE });

/** A Target: an integer from 0 to 100,000. */
export const targetAccounts = z
  .number({ error: (issue) => (issue.input === undefined ? REQUIRED_MESSAGE : TARGET_MESSAGE) })
  .int({ error: TARGET_MESSAGE })
  .min(0, { error: TARGET_MESSAGE })
  .max(TARGET_MAX, { error: TARGET_MESSAGE });

/**
 * Setting one Funding Officer's Target for a month (E5-S1 criterion 1, EC17): an upsert. `version` is
 * the version of the Target the client loaded, or null when the month had no Target.
 */
export const setTargetInput = z.object({
  fundingOfficerId: requiredId,
  month: calendarMonth,
  accounts: targetAccounts,
  version: version.nullable(),
});

/** The query string of GET /api/targets and GET /api/dashboard: `month` "YYYY-MM", default the current WIB month. */
export const monthQuery = z.preprocess(
  (value) =>
    Object.fromEntries(
      Object.entries(value as Record<string, string>).filter(([, item]) => typeof item === "string" && item.trim() !== ""),
    ),
  z.object({ month: calendarMonth.optional() }),
);
