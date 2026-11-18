import { requireAdmin } from "@/server/auth";
import { archivePipelineTemplate, pipelineTemplateStatusInput } from "@/server/pipeline-templates";
import { assertSameOrigin, parseJson, toErrorResponse } from "@/server/http";

/**
 * Archives a template: it can no longer start a Pipeline, and can be restored (E3-S1 criteria 4 and 5).
 * Idempotent: when it is already archived, 200 with the template unchanged.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/pipeline-templates/[id]/archive">) {
  try {
    await requireAdmin(request);
    assertSameOrigin(request);
    const { id } = await params;
    const input = await parseJson(request, pipelineTemplateStatusInput);
    return Response.json(await archivePipelineTemplate(id, input), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
