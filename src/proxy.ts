// Optimistic sign-in check (ADR 0002). It only looks for the session cookie and never touches the
// database; the real check is requireAdmin() in every Route Handler and Server Component that reads data.
import { type NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/server/auth/cookie";
import { UNAUTHORIZED_MESSAGE, errorResponse } from "@/server/http/errors";

/** Paths that need no session: the sign-in page, sign-in itself and the health check. Exact matches. */
const PUBLIC_PATHS = new Set(["/masuk", "/api/auth/sign-in", "/api/health"]);

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PATHS.has(pathname) || request.cookies.get(SESSION_COOKIE)?.value) {
    return NextResponse.next();
  }
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    return errorResponse(401, "unauthorized", UNAUTHORIZED_MESSAGE);
  }
  const signIn = new URL("/masuk", request.url);
  signIn.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(signIn);
}

export const config = {
  matcher: [
    // Everything except Next.js build output, images, and static files such as the favicon,
    // the web app manifest, icons, fonts, robots.txt and sitemap.xml.
    "/((?!_next/static|_next/image|favicon\\.ico|manifest\\.webmanifest|icons/|.*\\.(?:png|jpe?g|gif|svg|ico|webp|avif|txt|xml|webmanifest|woff2?)$).*)",
  ],
};
