import { requireAdmin } from "@/server/auth";
import { pipelineOutcomeInput, setPipelineOutcome } from "@/server/pipelines";
import { assertSameOrigin, parseJson, toErrorResponse } from "@/server/http";

/** Sets the Outcome: Won, Lost, On Hold, or "open" to resume (E3-S3 criterion 5, EC24). */
export async function POST(request: Request, { params }: RouteContext<"/api/pipelines/[id]/outcome">) {
  try {
    await requireAdmin(request);
    assertSameOrigin(request);
    const { id } = await params;
    const input = await parseJson(request, pipelineOutcomeInput);
    return Response.json(await setPipelineOutcome(id, input), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
