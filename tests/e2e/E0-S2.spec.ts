import { expect, test } from "@playwright/test";

// The dev server uses DATABASE_URL: the local Docker bftm_dev, or the CI service database.
test.describe("E0-S2 health check", () => {
  test("GET /api/health answers 200 with the database ok, uncached", async ({ request }) => {
    const response = await request.get("/api/health");

    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(await response.json()).toEqual({ status: "ok", database: "ok" });
  });
});
