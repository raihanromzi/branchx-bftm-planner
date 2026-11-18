import { requireAdmin } from "@/server/auth";
import { deletePipelineTask, updatePipelineTask, updatePipelineTaskInput } from "@/server/pipelines";
import { assertSameOrigin, parseJson, toErrorResponse } from "@/server/http";

const NO_STORE = { "Cache-Control": "no-store" };

/** Ticks, unticks or sets the due date of one Pipeline Task (E3-S3 criterion 4). Answers the whole Pipeline. */
export async function PATCH(request: Request, { params }: RouteContext<"/api/pipeline-tasks/[id]">) {
  try {
    await requireAdmin(request);
    assertSameOrigin(request);
    const { id } = await params;
    const input = await parseJson(request, updatePipelineTaskInput);
    return Response.json(await updatePipelineTask(id, input), { headers: NO_STORE });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** Removes the Task from this one Pipeline (E3-S3 criterion 4, EC22). 204 with no body. */
export async function DELETE(request: Request, { params }: RouteContext<"/api/pipeline-tasks/[id]">) {
  try {
    await requireAdmin(request);
    assertSameOrigin(request);
    const { id } = await params;
    await deletePipelineTask(id);
    return new Response(null, { status: 204, headers: NO_STORE });
  } catch (error) {
    return toErrorResponse(error);
  }
}
