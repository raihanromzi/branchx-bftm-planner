import { requireAdmin } from "@/server/auth";
import { listMapProspects, mapProspectQuery } from "@/server/prospects";
import { toErrorResponse, validationApiError } from "@/server/http";

/** Every located, non-archived Prospect with its latest Pipeline's Stage, for the map (E6-S1). */
export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const parsed = mapProspectQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) throw validationApiError(parsed.error);
    return Response.json(await listMapProspects(parsed.data), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
