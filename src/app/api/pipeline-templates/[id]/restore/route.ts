import { requireAdmin } from "@/server/auth";
import { pipelineTemplateStatusInput, restorePipelineTemplate } from "@/server/pipeline-templates";
import { assertSameOrigin, parseJson, toErrorResponse } from "@/server/http";

/**
 * Restores an archived template (E3-S1 criterion 5).
 * Idempotent: when it is not archived, 200 with the template unchanged.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/pipeline-templates/[id]/restore">) {
  try {
    await requireAdmin(request);
    assertSameOrigin(request);
    const { id } = await params;
    const input = await parseJson(request, pipelineTemplateStatusInput);
    return Response.json(await restorePipelineTemplate(id, input), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
