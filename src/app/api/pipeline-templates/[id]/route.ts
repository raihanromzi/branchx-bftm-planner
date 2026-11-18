import { requireAdmin } from "@/server/auth";
import {
  deletePipelineTemplate,
  getPipelineTemplate,
  updatePipelineTemplate,
  updatePipelineTemplateInput,
} from "@/server/pipeline-templates";
import { assertSameOrigin, parseJson, toErrorResponse } from "@/server/http";

const NO_STORE = { "Cache-Control": "no-store" };

/** One template with its Stages and Tasks in order. An archived one is returned too, with archived: true. */
export async function GET(request: Request, { params }: RouteContext<"/api/pipeline-templates/[id]">) {
  try {
    await requireAdmin(request);
    const { id } = await params;
    return Response.json(await getPipelineTemplate(id), { headers: NO_STORE });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** Saves the whole template (name, Stages, Tasks), checked against the version the client loaded. */
export async function PUT(request: Request, { params }: RouteContext<"/api/pipeline-templates/[id]">) {
  try {
    await requireAdmin(request);
    assertSameOrigin(request);
    const { id } = await params;
    const input = await parseJson(request, updatePipelineTemplateInput);
    return Response.json(await updatePipelineTemplate(id, input), { headers: NO_STORE });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** Deletes a template no Pipeline uses (E3-S1 criterion 4, EC21). 204 with no body. */
export async function DELETE(request: Request, { params }: RouteContext<"/api/pipeline-templates/[id]">) {
  try {
    await requireAdmin(request);
    assertSameOrigin(request);
    const { id } = await params;
    await deletePipelineTemplate(id);
    return new Response(null, { status: 204, headers: NO_STORE });
  } catch (error) {
    return toErrorResponse(error);
  }
}
