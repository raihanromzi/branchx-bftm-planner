// The one error shape every Route Handler returns (ADR 0003, docs/product/api.md):
// { "error": { "code", "message", "fields"?: { [field]: message } } }
import "server-only";
import type { z } from "zod";
import { VERSION_CONFLICT_MESSAGE } from "@/server/validation";

export type ErrorBody = { error: { code: string; message: string; fields?: Record<string, string> } };

export const VALIDATION_MESSAGE = "Periksa kembali isian yang ditandai.";
export const NOT_FOUND_MESSAGE = "Data tidak ditemukan.";
export const UNAUTHORIZED_MESSAGE = "Sesi Anda sudah berakhir. Silakan masuk lagi.";
export const INTERNAL_MESSAGE = "Terjadi kesalahan di server. Coba lagi.";

/** An error a service or helper throws to end the request with a given status and body. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function errorResponse(status: number, code: string, message: string, fields?: Record<string, string>): Response {
  const body: ErrorBody = { error: fields ? { code, message, fields } : { code, message } };
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** One message per field, keyed by the field path joined with "." (for example "contact.phone"). */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.map(String).join(".");
    if (path && !(path in fields)) fields[path] = issue.message;
  }
  return fields;
}

export function validationApiError(error: z.ZodError): ApiError {
  const fields = fieldErrors(error);
  // A problem with the body as a whole (not a field) is reported in the message.
  const message = Object.keys(fields).length > 0 ? VALIDATION_MESSAGE : (error.issues[0]?.message ?? VALIDATION_MESSAGE);
  return new ApiError(400, "validation", message, fields);
}

/** 400 with per-field messages from a zod error. */
export function validationError(error: z.ZodError): Response {
  const apiError = validationApiError(error);
  return errorResponse(apiError.status, apiError.code, apiError.message, apiError.fields);
}

export const unauthorized = (message = UNAUTHORIZED_MESSAGE) => new ApiError(401, "unauthorized", message);
export const notFound = (message = NOT_FOUND_MESSAGE) => new ApiError(404, "not_found", message);
/** 409 for a rule conflict, such as a duplicate. */
export const conflict = (message: string, code = "conflict") => new ApiError(409, code, message);
/** 409 for an update sent with a version that is no longer current. */
export const versionConflict = () => new ApiError(409, "version_conflict", VERSION_CONFLICT_MESSAGE);
/** 422 for a forbidden state transition. */
export const invalidState = (message: string, code = "invalid_state") => new ApiError(422, code, message);

/**
 * Turns anything a handler threw into a response: ApiError as itself, anything else as a
 * generic 500 whose details stay in the server log.
 */
export function toErrorResponse(error: unknown): Response {
  if (error instanceof ApiError) return errorResponse(error.status, error.code, error.message, error.fields);
  const reason =
    (error as { code?: string })?.code ?? (error instanceof Error ? error.name : "unknown");
  console.error(`[api] unexpected error: ${reason}`);
  return errorResponse(500, "internal", INTERNAL_MESSAGE);
}
