import { expect, test } from "@playwright/test";
import { E2E_ADMIN } from "./support/admin";

// E0-S3: sign-in, the session cookie and sign-out, through the running app (proxy.ts included).
test.describe("E0-S3 Admin sign-in", () => {
  test("a signed-out visit to a page is sent to /masuk with the page to return to", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL("/masuk?next=%2F");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("BFTM Planner");
  });

  test("GET /api/auth/me without a session cookie is 401", async ({ request }) => {
    const response = await request.get("/api/auth/me");
    expect(response.status()).toBe(401);
    expect((await response.json()).error.code).toBe("unauthorized");
  });

  test("sign in, read the session, sign out, and the old session no longer works", async ({ playwright, baseURL }) => {
    const request = await playwright.request.newContext({ baseURL });
    try {
      const signIn = await request.post("/api/auth/sign-in", {
        data: { email: E2E_ADMIN.email, password: E2E_ADMIN.password },
      });
      expect(signIn.status()).toBe(200);
      expect(await signIn.json()).toEqual({ admin: { email: E2E_ADMIN.email } });
      const setCookie = signIn.headers()["set-cookie"] ?? "";
      expect(setCookie).toMatch(/^bftm_session=[^;]+;/);
      expect(setCookie).toMatch(/HttpOnly/);
      expect(setCookie).toMatch(/SameSite=Lax/);
      expect(setCookie).toMatch(/Max-Age=2592000/);

      const oldCookie = (await request.storageState()).cookies.find((cookie) => cookie.name === "bftm_session");
      expect(oldCookie?.httpOnly).toBe(true);

      const me = await request.get("/api/auth/me");
      expect(me.status()).toBe(200);
      expect(await me.json()).toEqual({ admin: { email: E2E_ADMIN.email } });

      expect((await request.post("/api/auth/sign-out")).status()).toBe(204);
      expect((await request.get("/api/auth/me")).status()).toBe(401);

      // Replaying the old cookie after sign-out is refused: the session ended on the server.
      const replay = await request.get("/api/auth/me", {
        headers: { cookie: `bftm_session=${oldCookie?.value}` },
      });
      expect(replay.status()).toBe(401);
    } finally {
      await request.dispose();
    }
  });
});
