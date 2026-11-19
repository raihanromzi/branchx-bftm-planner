// The small typed fetch wrapper client components use to call the JSON Route Handlers (ADR 0003).
// It does not throw for HTTP or network failures: a network failure is { ok: false, status: 0 }, so every
// caller handles one shape. Only an aborted request (the caller's own signal) rejects.

export type ApiErrorBody = {
  code: string;
  message: string;
  fields?: Record<string, string | undefined>;
};

export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: ApiErrorBody };

/** Shown when there is no response at all. */
export const NETWORK_MESSAGE = "Tidak bisa terhubung. Periksa koneksi, lalu coba lagi.";
/** Shown for an error response without the usual error body. */
export const SERVER_MESSAGE = "Permintaan gagal diproses. Coba lagi sebentar lagi.";

type Options = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  /** A create's Idempotency-Key (api.md): generated once per form submission, reused on a retry. */
  idempotencyKey?: string;
  signal?: AbortSignal;
};

export async function apiRequest<T>(path: string, { method = "GET", body, idempotencyKey, signal }: Options = {}): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    return { ok: false, status: 0, error: { code: "network", message: NETWORK_MESSAGE } };
  }

  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    // An empty (204) or non-JSON body: handled below.
  }

  if (response.ok) return { ok: true, status: response.status, data: json as T };
  const error = (json as { error?: Partial<ApiErrorBody> } | null)?.error;
  return {
    ok: false,
    status: response.status,
    error: {
      code: error?.code ?? "internal",
      message: error?.message ?? SERVER_MESSAGE,
      fields: error?.fields,
    },
  };
}
