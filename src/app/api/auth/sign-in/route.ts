import { sessionCookie, signIn } from "@/server/auth";
import { assertSameOrigin, parseJson, toErrorResponse } from "@/server/http";
import { signInInput } from "@/server/validation";

// Public: the only API route besides /api/health that needs no session (ADR 0002, E0-S3 criterion 5).
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { email, password } = await parseJson(request, signInInput);
    const { admin, token } = await signIn(email, password);
    return Response.json(
      { admin: { email: admin.email } },
      { headers: { "Set-Cookie": sessionCookie(token), "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
