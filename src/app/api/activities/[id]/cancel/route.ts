import { requireAdmin } from "@/server/auth";
import { activityStatusInput, cancelActivity } from "@/server/activities";
import { assertSameOrigin, parseJson, toErrorResponse } from "@/server/http";

/** Cancels a Scheduled Activity (E4-S1 criterion 3, EC27). Done and Cancelled are final. */
export async function POST(request: Request, { params }: RouteContext<"/api/activities/[id]/cancel">) {
  try {
    await requireAdmin(request);
    assertSameOrigin(request);
    const { id } = await params;
    const input = await parseJson(request, activityStatusInput);
    return Response.json(await cancelActivity(id, input), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
