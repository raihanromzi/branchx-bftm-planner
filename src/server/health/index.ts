import "server-only";
import { getSql } from "@/server/db";

/** How long the health check waits for the database before reporting it as down. */
export const HEALTH_TIMEOUT_MS = 3000;

export type DatabaseStatus = "ok" | "error";

/** Runs `select 1` on the app database. Never throws; failures are logged server-side only. */
export async function checkDatabase(timeoutMs = HEALTH_TIMEOUT_MS): Promise<DatabaseStatus> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs);
    });
    await Promise.race([getSql()`select 1`, timeout]);
    return "ok";
  } catch (error) {
    // Log only the error code or kind: messages can contain the host and database name.
    const reason =
      (error as { code?: string })?.code ?? (error instanceof Error ? error.message.split(":")[0] : "unknown");
    console.error(`[health] database check failed: ${reason}`);
    return "error";
  } finally {
    clearTimeout(timer);
  }
}

/** The GET /api/health response: 200 when the database answers, 503 otherwise. No connection details. */
export async function healthResponse(): Promise<Response> {
  const database = await checkDatabase();
  const ok = database === "ok";
  return Response.json(
    { status: ok ? "ok" : "error", database },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
