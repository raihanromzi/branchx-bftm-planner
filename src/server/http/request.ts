import "server-only";
import type { z } from "zod";
import { ApiError, validationApiError } from "./errors";

/** Reads a JSON body and validates it. Throws ApiError 400 ("invalid_json" or "validation"). */
export async function parseJson<S extends z.ZodType>(request: Request, schema: S): Promise<z.output<S>> {
  let data: unknown;
  try {
    data = await request.json();
  } catch {
    throw new ApiError(400, "invalid_json", "Isi permintaan bukan JSON yang valid.");
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw validationApiError(parsed.error);
  return parsed.data;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF guard (ADR 0002): a mutation whose Origin header is present and does not match the host
 * the request was sent to is refused with 403. Requests without an Origin header pass.
 */
export function assertSameOrigin(request: Request): void {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return;
  const origin = request.headers.get("origin");
  if (origin === null) return;
  const host =
    request.headers.get("x-forwarded-host")?.split(",")[0].trim() ||
    request.headers.get("host") ||
    new URL(request.url).host;
  let originHost: string | undefined;
  try {
    originHost = new URL(origin).host;
  } catch {
    originHost = undefined;
  }
  if (!originHost || originHost.toLowerCase() !== host.toLowerCase()) {
    throw new ApiError(403, "forbidden_origin", "Permintaan ditolak karena asalnya tidak dikenal.");
  }
}
