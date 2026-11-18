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

/** Required free text: trimmed, not empty, at most `max` characters (default 500), no NIK or account numbers. */
export function freeText({ max = FREE_TEXT_MAX }: { max?: number } = {}) {
  return textRules(z.string().trim().min(1, { error: REQUIRED_MESSAGE }), max);
}

/** Optional free text: same rules; missing, null or blank becomes null. */
export function optionalFreeText({ max = FREE_TEXT_MAX }: { max?: number } = {}) {
  return textRules(z.string().trim(), max)
    .nullish()
    .transform((value) => (value ? value : null));
}

/** The `version` an update sends back: the version the client loaded (ADR 0003). */
export const version = z.number().int().min(1);
