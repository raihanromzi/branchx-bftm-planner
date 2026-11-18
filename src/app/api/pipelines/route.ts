import { requireAdmin } from "@/server/auth";
import {
  START_SCOPE,
  getPipeline,
  listPipelinesForProspect,
  pipelineListQuery,
  startPipeline,
  startPipelineInput,
} from "@/server/pipelines";
import {
  assertSameOrigin,
  parseJson,
  readIdempotencyKey,
  toErrorResponse,
  validationApiError,
  withIdempotency,
} from "@/server/http";

const NO_STORE = { "Cache-Control": "no-store" };

/** A Prospect's Pipelines, newest first (?prospectId=, required). */
export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const parsed = pipelineListQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) throw validationApiError(parsed.error);
    return Response.json({ items: await listPipelinesForProspect(parsed.data.prospectId) }, { headers: NO_STORE });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * Starts a Pipeline for a Prospect from a template (E3-S3 criterion 1). 201 with the Pipeline; 200
 * with the same Pipeline on a repeat of the Idempotency-Key.
 */
export async function POST(request: Request) {
  try {
    await requireAdmin(request);
    assertSameOrigin(request);
    const key = readIdempotencyKey(request);
    const input = await parseJson(request, startPipelineInput);
    const { id, created } = await withIdempotency(START_SCOPE, key, (tx) => startPipeline(input, { db: tx }));
    return Response.json(await getPipeline(id), { status: created ? 201 : 200, headers: NO_STORE });
  } catch (error) {
    return toErrorResponse(error);
  }
}
