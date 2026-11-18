// Sign-in with lockout (ADR 0002, E0-S3 criteria 2 to 4, EC41).
import "server-only";
import { and, count, eq, gt, lte, sql } from "drizzle-orm";
import { admin, signInAttempt } from "@/db/schema";
import { getDb } from "@/server/db";
import { ApiError } from "@/server/http/errors";
import { normalizeEmail } from "./email";
import { verifyDummyPassword, verifyPassword } from "./password";
import { type SessionAdmin, createSession } from "./session";

export const INVALID_CREDENTIALS_MESSAGE = "Email atau kata sandi salah.";
export const LOCKOUT_MESSAGE = "Terlalu banyak percobaan. Coba lagi dalam 15 menit.";
/** Failures for one email within the window that lock it. */
export const LOCKOUT_FAILURES = 5;
export const LOCKOUT_WINDOW_MINUTES = 15;

const invalidCredentials = () => new ApiError(401, "invalid_credentials", INVALID_CREDENTIALS_MESSAGE);
const lockedOut = () => new ApiError(429, "locked_out", LOCKOUT_MESSAGE);

type Outcome = { ok: true; admin: SessionAdmin; token: string } | { ok: false; error: ApiError };

/**
 * Checks the email and password and, when they match, creates a session and returns its token.
 *
 * - The email is normalised (trimmed, lower-cased) before anything else.
 * - With 5 or more failures for the email in the last 15 minutes the attempt is refused with 429
 *   before the password is checked, whether or not the email belongs to an Admin. Refused attempts
 *   are not recorded, so they do not extend the lockout.
 * - A wrong email and a wrong password both throw the same 401 and record a failure. An unknown email
 *   still runs a scrypt check, so the timing is the same.
 * - A success deletes the email's failures.
 *
 * Attempts for one email are serialised with a transaction-scoped advisory lock, so parallel guesses
 * cannot all pass the count before any failure is recorded.
 */
export async function signIn(rawEmail: string, password: string): Promise<{ admin: SessionAdmin; token: string }> {
  const email = normalizeEmail(rawEmail);
  const outcome = await getDb().transaction(async (tx): Promise<Outcome> => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`sign-in:${email}`}, 0))`);

    const windowStart = sql`now() - make_interval(mins => ${LOCKOUT_WINDOW_MINUTES})`;
    await tx
      .delete(signInAttempt)
      .where(and(eq(signInAttempt.email, email), lte(signInAttempt.attemptedAt, windowStart)));
    const [{ failures }] = await tx
      .select({ failures: count() })
      .from(signInAttempt)
      .where(and(eq(signInAttempt.email, email), gt(signInAttempt.attemptedAt, windowStart)));
    if (failures >= LOCKOUT_FAILURES) return { ok: false, error: lockedOut() };

    const [found] = await tx
      .select({ id: admin.id, email: admin.email, passwordHash: admin.passwordHash })
      .from(admin)
      .where(eq(admin.email, email));
    const matches = found ? await verifyPassword(password, found.passwordHash) : await verifyDummyPassword(password);

    if (!found || !matches) {
      // Recorded inside this transaction, which commits: the outcome is returned, not thrown.
      await tx.insert(signInAttempt).values({ email });
      return { ok: false, error: invalidCredentials() };
    }

    await tx.delete(signInAttempt).where(eq(signInAttempt.email, email));
    const token = await createSession(found.id, { db: tx });
    return { ok: true, admin: { id: found.id, email: found.email }, token };
  });

  if (!outcome.ok) throw outcome.error;
  return { admin: outcome.admin, token: outcome.token };
}
