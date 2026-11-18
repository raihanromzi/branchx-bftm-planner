import { requireAdmin } from "@/server/auth";
import { fundingOfficerStatusInput, setFundingOfficerActive } from "@/server/funding-officers";
import { assertSameOrigin, parseJson, toErrorResponse } from "@/server/http";

/**
 * Deactivates a Funding Officer: no new work can be assigned to them (E1-S1 criterion 3).
 * Idempotent: when it is already in that state, 200 with the record unchanged.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/funding-officers/[id]/deactivate">) {
  try {
    await requireAdmin(request);
    assertSameOrigin(request);
    const { id } = await params;
    const input = await parseJson(request, fundingOfficerStatusInput);
    return Response.json(await setFundingOfficerActive(id, false, input), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
