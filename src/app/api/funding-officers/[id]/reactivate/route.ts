import { requireAdmin } from "@/server/auth";
import { fundingOfficerStatusInput, setFundingOfficerActive } from "@/server/funding-officers";
import { assertSameOrigin, parseJson, toErrorResponse } from "@/server/http";

/**
 * Reactivates a deactivated Funding Officer (E1-S1 criterion 4).
 * Idempotent: when it is already in that state, 200 with the record unchanged.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/funding-officers/[id]/reactivate">) {
  try {
    await requireAdmin(request);
    assertSameOrigin(request);
    const { id } = await params;
    const input = await parseJson(request, fundingOfficerStatusInput);
    return Response.json(await setFundingOfficerActive(id, true, input), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
