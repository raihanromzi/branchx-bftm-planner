import { requireAdmin } from "@/server/auth";
import {
  CREATE_SCOPE,
  createProspect,
  createProspectInput,
  listProspects,
  prospectListQuery,
  savedProspect,
} from "@/server/prospects";
import {
  assertSameOrigin,
  parseJson,
  readIdempotencyKey,
  toErrorResponse,
  validationApiError,
  withIdempotency,
} from "@/server/http";

const NO_STORE = { "Cache-Control": "no-store" };

/** A page of 50 Prospects, sorted by name, with search and filters (E2-S1 criterion 4). */
export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const parsed = prospectListQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) throw validationApiError(parsed.error);
    return Response.json(await listProspects(parsed.data), { headers: NO_STORE });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * Adds a Prospect. 201 { prospect, duplicates } on create; 200 with the same shape on a repeat of
 * the key. A matching name never blocks the save (EC14).
 */
export async function POST(request: Request) {
  try {
    await requireAdmin(request);
    assertSameOrigin(request);
    const key = readIdempotencyKey(request);
    const input = await parseJson(request, createProspectInput);
    const { id, created } = await withIdempotency(CREATE_SCOPE, key, (tx) => createProspect(input, { db: tx }));
    return Response.json(await savedProspect(id), { status: created ? 201 : 200, headers: NO_STORE });
  } catch (error) {
    return toErrorResponse(error);
  }
}
