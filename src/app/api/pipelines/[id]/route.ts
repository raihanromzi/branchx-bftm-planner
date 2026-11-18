import { requireAdmin } from "@/server/auth";
import { changePipelineFundingOfficer, changePipelineFundingOfficerInput, getPipeline } from "@/server/pipelines";
import { assertSameOrigin, parseJson, toErrorResponse } from "@/server/http";

const NO_STORE = { "Cache-Control": "no-store" };

// No DELETE: a Pipeline is never deleted (EC22).

/** One Pipeline with its Stages and Tasks. */
export async function GET(request: Request, { params }: RouteContext<"/api/pipelines/[id]">) {
  try {
    await requireAdmin(request);
    const { id } = await params;
    return Response.json(await getPipeline(id), { headers: NO_STORE });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** Changes the Pipeline's own Funding Officer (E3-S3 criterion 7, EC26). */
export async function PATCH(request: Request, { params }: RouteContext<"/api/pipelines/[id]">) {
  try {
    await requireAdmin(request);
    assertSameOrigin(request);
    const { id } = await params;
    const input = await parseJson(request, changePipelineFundingOfficerInput);
    return Response.json(await changePipelineFundingOfficer(id, input), { headers: NO_STORE });
  } catch (error) {
    return toErrorResponse(error);
  }
}
