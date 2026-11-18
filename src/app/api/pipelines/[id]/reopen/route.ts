import { requireAdmin } from "@/server/auth";
import { pipelineStatusInput, reopenPipeline } from "@/server/pipelines";
import { assertSameOrigin, parseJson, toErrorResponse } from "@/server/http";

/** Reopens a Won or Lost Pipeline at the Stage it was in (E3-S3 criterion 6, EC25). */
export async function POST(request: Request, { params }: RouteContext<"/api/pipelines/[id]/reopen">) {
  try {
    await requireAdmin(request);
    assertSameOrigin(request);
    const { id } = await params;
    const input = await parseJson(request, pipelineStatusInput);
    return Response.json(await reopenPipeline(id, input), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
