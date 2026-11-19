import { requireAdmin } from "@/server/auth";
import { getDeactivationPreview } from "@/server/funding-officers";
import { toErrorResponse } from "@/server/http";

/** The Funding Officer's open work, for the deactivation confirmation (E1-S3 criterion 1, EC20). Changes nothing. */
export async function GET(request: Request, { params }: RouteContext<"/api/funding-officers/[id]/deactivation-preview">) {
  try {
    await requireAdmin(request);
    const { id } = await params;
    return Response.json(await getDeactivationPreview(id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
