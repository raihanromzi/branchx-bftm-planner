// The real session check for Route Handlers (ADR 0002). proxy.ts only checks that a cookie exists.
import "server-only";
import { unauthorized } from "@/server/http/errors";
import { type SessionAdmin, findAdminBySessionToken, readSessionCookie } from "./session";

/**
 * The signed-in Admin for a Route Handler request, looked up by the bftm_session cookie in the
 * `session` table (unexpired only). Throws ApiError 401 "unauthorized" otherwise.
 * Every Route Handler except sign-in and health calls this first (E0-S3 criterion 5).
 */
export async function requireAdmin(request: Request): Promise<SessionAdmin> {
  const token = readSessionCookie(request);
  const admin = token ? await findAdminBySessionToken(token) : null;
  if (!admin) throw unauthorized();
  return admin;
}
