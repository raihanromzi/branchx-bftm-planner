import { requireAdmin } from "@/server/auth";
import {
  CREATE_SCOPE,
  createPipelineTemplate,
  createPipelineTemplateInput,
  getPipelineTemplate,
  listPipelineTemplates,
} from "@/server/pipeline-templates";
import { assertSameOrigin, parseJson, readIdempotencyKey, toErrorResponse, withIdempotency } from "@/server/http";

const NO_STORE = { "Cache-Control": "no-store" };

/** Every Pipeline Template: active first, then archived, each by name, with Stage and Pipeline counts. */
export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    return Response.json({ items: await listPipelineTemplates() }, { headers: NO_STORE });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** Adds a template with its Stages and Tasks. 201 on create; 200 with the same template on a repeat of the key. */
export async function POST(request: Request) {
  try {
    await requireAdmin(request);
    assertSameOrigin(request);
    const key = readIdempotencyKey(request);
    const input = await parseJson(request, createPipelineTemplateInput);
    const { id, created } = await withIdempotency(CREATE_SCOPE, key, (tx) => createPipelineTemplate(input, { db: tx }));
    return Response.json(await getPipelineTemplate(id), { status: created ? 201 : 200, headers: NO_STORE });
  } catch (error) {
    return toErrorResponse(error);
  }
}
