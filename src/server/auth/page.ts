// The session check for Server Components (ADR 0002). Route Handlers use requireAdmin(request) instead.
// Kept apart from index.ts because it depends on next/headers and next/navigation.
import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { SESSION_COOKIE, type SessionAdmin, findAdminBySessionToken } from "./session";

/** The signed-in Admin, or null. Memoised for one render pass with React cache. */
export const getAdmin = cache(async (): Promise<SessionAdmin | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? findAdminBySessionToken(token) : null;
});

/**
 * The signed-in Admin for a Server Component that reads data. Without a valid session it redirects to
 * /masuk?next=<path>, so the Admin comes back to `path` after signing in.
 */
export async function requireAdminPage(path: string): Promise<SessionAdmin> {
  const admin = await getAdmin();
  if (!admin) redirect(`/masuk?${new URLSearchParams({ next: path })}`);
  return admin;
}
