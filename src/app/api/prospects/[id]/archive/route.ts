import { requireAdmin } from "@/server/auth";
import { archiveProspect, prospectStatusInput } from "@/server/prospects";
import { assertSameOrigin, parseJson, toErrorResponse } from "@/server/http";

/**
 * Archives a Prospect: it leaves the default list and can be restored (E2-S1 criterion 7).
 * Idempotent: when it is already archived, 200 with the record unchanged.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/prospects/[id]/archive">) {
  try {
    await requireAdmin(request);
    assertSameOrigin(request);
    const { id } = await params;
    const input = await parseJson(request, prospectStatusInput);
    return Response.json(await archiveProspect(id, input), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
