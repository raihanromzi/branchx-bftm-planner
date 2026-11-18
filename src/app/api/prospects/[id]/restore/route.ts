import { requireAdmin } from "@/server/auth";
import { prospectStatusInput, restoreProspect } from "@/server/prospects";
import { assertSameOrigin, parseJson, toErrorResponse } from "@/server/http";

/**
 * Restores an archived Prospect (E2-S1 criterion 7).
 * Idempotent: when it is not archived, 200 with the record unchanged.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/prospects/[id]/restore">) {
  try {
    await requireAdmin(request);
    assertSameOrigin(request);
    const { id } = await params;
    const input = await parseJson(request, prospectStatusInput);
    return Response.json(await restoreProspect(id, input), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
