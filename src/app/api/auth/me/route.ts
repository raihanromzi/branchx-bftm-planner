import { requireAdmin } from "@/server/auth";
import { toErrorResponse } from "@/server/http";

/** The signed-in Admin, or 401. Reading the request's cookie keeps this out of build-time prerendering. */
export async function GET(request: Request) {
  try {
    const admin = await requireAdmin(request);
    return Response.json({ admin: { email: admin.email } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
