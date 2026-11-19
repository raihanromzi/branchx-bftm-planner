import { requireAdmin } from "@/server/auth";
import { getActivity } from "@/server/activities";
import { toErrorResponse } from "@/server/http";

// No DELETE, PATCH or PUT: an Activity is only cancelled, or made Done by a Check-in (EC22, EC27).

/** One Activity. */
export async function GET(request: Request, { params }: RouteContext<"/api/activities/[id]">) {
  try {
    await requireAdmin(request);
    const { id } = await params;
    return Response.json(await getActivity(id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
