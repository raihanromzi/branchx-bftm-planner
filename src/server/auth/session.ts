// Database sessions (ADR 0002): a random token in the bftm_session cookie, its SHA-256 hash in `session`.
import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lte, sql } from "drizzle-orm";
import { admin, session } from "@/db/schema";
import { type Db, type Tx, getDb } from "@/server/db";

import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "./cookie";

export { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS };

export type SessionAdmin = { id: string; email: string };

/** The hex SHA-256 of a session token: what the `session` table stores instead of the token. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Creates a session for the Admin and returns the raw token for the cookie. */
export async function createSession(adminId: string, { db = getDb() }: { db?: Db | Tx } = {}): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  // Expired sessions are useless; clear them out whenever a new one is made.
  await db.delete(session).where(lte(session.expiresAt, sql`now()`));
  await db.insert(session).values({
    adminId,
    tokenHash: hashSessionToken(token),
    expiresAt: sql`now() + make_interval(secs => ${SESSION_MAX_AGE_SECONDS})`,
  });
  return token;
}

/** The Admin a session token belongs to, or null when the token is unknown or its session has expired. */
export async function findAdminBySessionToken(token: string): Promise<SessionAdmin | null> {
  if (!token) return null;
  const [row] = await getDb()
    .select({ id: admin.id, email: admin.email })
    .from(session)
    .innerJoin(admin, eq(admin.id, session.adminId))
    .where(and(eq(session.tokenHash, hashSessionToken(token)), gt(session.expiresAt, sql`now()`)));
  return row ?? null;
}

/** Ends the session with this token, if any. */
export async function deleteSession(token: string): Promise<void> {
  if (!token) return;
  await getDb().delete(session).where(eq(session.tokenHash, hashSessionToken(token)));
}

/** The bftm_session value from a Cookie header, or undefined. */
export function readSessionCookie(request: Request): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === SESSION_COOKIE) {
      const value = part.slice(index + 1).trim();
      return value || undefined;
    }
  }
  return undefined;
}

function cookieAttributes(maxAge: number): string {
  const expires = maxAge > 0 ? new Date(Date.now() + maxAge * 1000) : new Date(0);
  const attributes = [`Path=/`, `Max-Age=${maxAge}`, `Expires=${expires.toUTCString()}`, "HttpOnly", "SameSite=Lax"];
  if (process.env.NODE_ENV === "production") attributes.push("Secure");
  return attributes.join("; ");
}

/** Set-Cookie value for a new session: httpOnly, SameSite=Lax, Path=/, 30 days, Secure in production. */
export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; ${cookieAttributes(SESSION_MAX_AGE_SECONDS)}`;
}

/** Set-Cookie value that removes the session cookie. */
export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; ${cookieAttributes(0)}`;
}
