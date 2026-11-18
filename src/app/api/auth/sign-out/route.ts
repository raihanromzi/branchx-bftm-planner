import { clearedSessionCookie, deleteSession, readSessionCookie, requireAdmin } from "@/server/auth";
import { assertSameOrigin, toErrorResponse } from "@/server/http";

/**
 * Ends this browser's session on the server and clears the cookie (E0-S3 criterion 6).
 * Without a valid session it answers 401 like every protected route, and still clears the cookie.
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
  } catch (error) {
    return toErrorResponse(error);
  }
  try {
    await requireAdmin(request);
    await deleteSession(readSessionCookie(request) ?? "");
    return new Response(null, {
      status: 204,
      headers: { "Set-Cookie": clearedSessionCookie(), "Cache-Control": "no-store" },
    });
  } catch (error) {
    const response = toErrorResponse(error);
    response.headers.append("Set-Cookie", clearedSessionCookie());
    return response;
  }
}
