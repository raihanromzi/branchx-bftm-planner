import { describe, expect, it } from "vitest";
import { DEFAULT_NEXT, safeNext } from "@/lib/safe-next";

// E0-S5, EC39: the sign-in screen honours `next` only when it is a same-site relative path.
describe("E0-S5 safeNext", () => {
  it("keeps a same-site path with its query and hash", () => {
    expect(safeNext("/prospect?x=1")).toBe("/prospect?x=1");
    expect(safeNext("/prospect")).toBe("/prospect");
    expect(safeNext("/prospek?q=abc#daftar")).toBe("/prospek?q=abc#daftar");
    expect(safeNext("/")).toBe("/");
  });

  it("falls back to the dashboard when there is no next", () => {
    expect(DEFAULT_NEXT).toBe("/");
    expect(safeNext(undefined)).toBe("/");
    expect(safeNext(null)).toBe("/");
    expect(safeNext("")).toBe("/");
    expect(safeNext("   ")).toBe("/");
  });

  it("refuses protocol-relative and backslash paths", () => {
    expect(safeNext("//evil.com")).toBe("/");
    expect(safeNext("//evil.com/prospect")).toBe("/");
    expect(safeNext("/\\evil.com")).toBe("/");
    expect(safeNext("\\\\evil.com")).toBe("/");
    expect(safeNext("/prospect\\..\\\\evil.com")).toBe("/");
  });

  it("refuses absolute URLs and schemes", () => {
    expect(safeNext("https://evil.com")).toBe("/");
    expect(safeNext("http://localhost:3000/prospect")).toBe("/");
    expect(safeNext("javascript:alert(1)")).toBe("/");
    expect(safeNext("JavaScript:alert(1)")).toBe("/");
    expect(safeNext("data:text/html,hai")).toBe("/");
    expect(safeNext("evil.com")).toBe("/");
    expect(safeNext("prospect")).toBe("/");
  });

  it("refuses values the browser would turn into another origin", () => {
    // URL parsers drop tabs and newlines, so "/\t/evil.com" would become "//evil.com".
    expect(safeNext("/\t/evil.com")).toBe("/");
    expect(safeNext("/\n/evil.com")).toBe("/");
    expect(safeNext("/\r/evil.com")).toBe("/");
    expect(safeNext(" //evil.com")).toBe("/");
    expect(safeNext("/\u0000/evil.com")).toBe("/");
  });

  it("refuses encoded variants once the query string is decoded", () => {
    // URLSearchParams decodes once: ?next=%2F%2Fevil.com arrives as "//evil.com".
    expect(safeNext(new URLSearchParams("next=%2F%2Fevil.com").get("next"))).toBe("/");
    expect(safeNext(new URLSearchParams("next=%2F%5Cevil.com").get("next"))).toBe("/");
    expect(safeNext(new URLSearchParams("next=https%3A%2F%2Fevil.com").get("next"))).toBe("/");
    expect(safeNext(new URLSearchParams("next=%2Fprospect%3Fx%3D1").get("next"))).toBe("/prospect?x=1");
    // Still encoded (decoded zero times): it does not start with "/", so it is refused.
    expect(safeNext("%2F%2Fevil.com")).toBe("/");
  });

  it("never sends the Admin back to the sign-in screen", () => {
    expect(safeNext("/masuk")).toBe("/");
    expect(safeNext("/masuk/")).toBe("/");
    expect(safeNext("/masuk?next=%2Fprospect")).toBe("/");
    expect(safeNext("/MASUK")).toBe("/");
  });

  it("refuses absurdly long values", () => {
    expect(safeNext(`/${"a".repeat(3000)}`)).toBe("/");
  });
});
