import { requireAdmin } from "@/server/auth";
import { getDashboard, monthQuery } from "@/server/dashboard";
import { toErrorResponse, validationApiError } from "@/server/http";

/** The dashboard summary for ?month= (default: this WIB month). Computed on every read. */
export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const parsed = monthQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) throw validationApiError(parsed.error);
    return Response.json(await getDashboard(parsed.data.month), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
