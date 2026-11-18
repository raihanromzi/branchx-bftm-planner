import { requireAdmin } from "@/server/auth";
import { getFundingOfficer, updateFundingOfficer, updateFundingOfficerInput } from "@/server/funding-officers";
import { assertSameOrigin, parseJson, toErrorResponse } from "@/server/http";

const NO_STORE = { "Cache-Control": "no-store" };

// No DELETE: a Funding Officer is deactivated, never deleted (E1-S1 criterion 5, EC22).

export async function GET(request: Request, { params }: RouteContext<"/api/funding-officers/[id]">) {
  try {
    await requireAdmin(request);
    const { id } = await params;
    return Response.json(await getFundingOfficer(id), { headers: NO_STORE });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** Changes the name and/or phone, checked against the version the client loaded. */
export async function PATCH(request: Request, { params }: RouteContext<"/api/funding-officers/[id]">) {
  try {
    await requireAdmin(request);
    assertSameOrigin(request);
    const { id } = await params;
    const input = await parseJson(request, updateFundingOfficerInput);
    return Response.json(await updateFundingOfficer(id, input), { headers: NO_STORE });
  } catch (error) {
    return toErrorResponse(error);
  }
}
