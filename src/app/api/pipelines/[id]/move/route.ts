import { requireAdmin } from "@/server/auth";
import { movePipeline, movePipelineInput } from "@/server/pipelines";
import { assertSameOrigin, parseJson, toErrorResponse } from "@/server/http";

/** Moves an open Pipeline to any of its Stages (E3-S3 criterion 3, EC23). Answers { pipeline, uncheckedTasksLeftBehind }. */
export async function POST(request: Request, { params }: RouteContext<"/api/pipelines/[id]/move">) {
  try {
    await requireAdmin(request);
    assertSameOrigin(request);
    const { id } = await params;
    const input = await parseJson(request, movePipelineInput);
    return Response.json(await movePipeline(id, input), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
