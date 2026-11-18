// Where the sign-in screen sends the Admin afterwards (E0-S5, EC39). `next` comes from the query string, so
// anyone can set it: honour it only when it is a path on this site, or the screen becomes an open redirect.

/** The dashboard: where the Admin goes when there is no usable `next`. */
export const DEFAULT_NEXT = "/";

const SIGN_IN_PATH = "/masuk";
const MAX_LENGTH = 2048;
// A placeholder origin to resolve the path against; any path that leaves it is refused.
const BASE = "http://bftm.invalid";

/**
 * The path to go to after signing in. `value` is the already-decoded `next` query value. It is kept only
 * when it is a same-site relative path: it starts with exactly one "/", not "//" or "/\", has no
 * backslash, whitespace or control character (URL parsers drop or rewrite those), resolves to this origin,
 * and is not the sign-in screen itself. Anything else gives the dashboard.
 */
export function safeNext(value: string | null | undefined): string {
  if (!value || value.length > MAX_LENGTH) return DEFAULT_NEXT;
  if (!value.startsWith("/") || value.startsWith("//")) return DEFAULT_NEXT;
  // Backslashes act as slashes in browsers; tabs, newlines and other control characters are stripped.
  if (/[\\\s\u0000-\u001f\u007f]/.test(value)) return DEFAULT_NEXT;

  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return DEFAULT_NEXT;
  }
  if (url.origin !== BASE) return DEFAULT_NEXT;

  // Dot segments collapse during parsing ("/.//evil.com" becomes "//evil.com"), so the result is checked
  // again: a returned path starting with "//" would leave the site.
  if (url.pathname.startsWith("//")) return DEFAULT_NEXT;

  const path = url.pathname.replace(/\/+$/, "").toLowerCase();
  if (path === SIGN_IN_PATH) return DEFAULT_NEXT;

  return `${url.pathname}${url.search}${url.hash}`;
}
