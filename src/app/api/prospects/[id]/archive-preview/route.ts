import { requireAdmin } from "@/server/auth";
import { getArchivePreview } from "@/server/prospects";
import { toErrorResponse } from "@/server/http";

/** How many future Scheduled Activities archiving would cancel (E4-S1 criterion 5, EC19). */
export async function GET(request: Request, { params }: RouteContext<"/api/prospects/[id]/archive-preview">) {
  try {
    await requireAdmin(request);
    const { id } = await params;
    return Response.json(await getArchivePreview(id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
