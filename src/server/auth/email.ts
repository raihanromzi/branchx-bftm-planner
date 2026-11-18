// Admin email rules, shared by sign-in and scripts/seed-admin.mts. No "server-only" or "@/" imports:
// the seed script runs this file in plain Node.

/** The longest email address accepted (RFC 5321). */
export const EMAIL_MAX = 254;

/** The form an email is stored and compared in: trimmed and lower-cased. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** A plain shape check (something@domain.tld, no spaces); good enough for a seeded Admin. */
export function isEmail(email: string): boolean {
  return email.length <= EMAIL_MAX && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
