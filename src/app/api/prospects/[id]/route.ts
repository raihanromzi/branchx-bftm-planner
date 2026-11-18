import { requireAdmin } from "@/server/auth";
import { getProspect, updateProspect, updateProspectInput } from "@/server/prospects";
import { assertSameOrigin, parseJson, toErrorResponse } from "@/server/http";

const NO_STORE = { "Cache-Control": "no-store" };

// No DELETE: a Prospect is archived, never deleted (E2-S1 criterion 7, EC22).

/** One Prospect. An archived one is returned too, with archived: true (EC40). */
export async function GET(request: Request, { params }: RouteContext<"/api/prospects/[id]">) {
  try {
    await requireAdmin(request);
    const { id } = await params;
    return Response.json(await getProspect(id), { headers: NO_STORE });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** Changes any of the fields, checked against the version the client loaded. Answers { prospect, duplicates }. */
export async function PATCH(request: Request, { params }: RouteContext<"/api/prospects/[id]">) {
  try {
    await requireAdmin(request);
    assertSameOrigin(request);
    const { id } = await params;
    const input = await parseJson(request, updateProspectInput);
    return Response.json(await updateProspect(id, input), { headers: NO_STORE });
  } catch (error) {
    return toErrorResponse(error);
  }
}
