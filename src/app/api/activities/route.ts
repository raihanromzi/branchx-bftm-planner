import { requireAdmin } from "@/server/auth";
import {
  CREATE_SCOPE,
  activityListQuery,
  createActivity,
  createActivityInput,
  getActivity,
  listActivities,
} from "@/server/activities";
import {
  assertSameOrigin,
  parseJson,
  readIdempotencyKey,
  toErrorResponse,
  validationApiError,
  withIdempotency,
} from "@/server/http";

const NO_STORE = { "Cache-Control": "no-store" };

/** Every Activity on the WIB days from..to, in time order, with `overdue` (E4-S1 criterion 4). */
export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const parsed = activityListQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) throw validationApiError(parsed.error);
    return Response.json({ items: await listActivities(parsed.data) }, { headers: NO_STORE });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** Schedules an Activity. 201 with the record; 200 with the same record on a repeat of the key. */
export async function POST(request: Request) {
  try {
    await requireAdmin(request);
    assertSameOrigin(request);
    const key = readIdempotencyKey(request);
    const input = await parseJson(request, createActivityInput);
    const { id, created } = await withIdempotency(CREATE_SCOPE, key, (tx) => createActivity(input, { db: tx }));
    return Response.json(await getActivity(id), { status: created ? 201 : 200, headers: NO_STORE });
  } catch (error) {
    return toErrorResponse(error);
  }
}
