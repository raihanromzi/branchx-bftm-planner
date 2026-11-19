import { requireAdmin } from "@/server/auth";
import { listTargets, monthQuery, setTarget, setTargetInput, wibMonth } from "@/server/dashboard";
import { assertSameOrigin, parseJson, toErrorResponse, validationApiError } from "@/server/http";

const NO_STORE = { "Cache-Control": "no-store" };

/** Each reported Funding Officer's Target (or null) and Actual for ?month= (default: this WIB month). */
export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const parsed = monthQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) throw validationApiError(parsed.error);
    return Response.json(await listTargets(parsed.data.month ?? wibMonth()), { headers: NO_STORE });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** Sets one Funding Officer's Target for a month: inserts or updates the one row (EC17). */
export async function PUT(request: Request) {
  try {
    await requireAdmin(request);
    assertSameOrigin(request);
    const input = await parseJson(request, setTargetInput);
    return Response.json(await setTarget(input), { headers: NO_STORE });
  } catch (error) {
    return toErrorResponse(error);
  }
}
