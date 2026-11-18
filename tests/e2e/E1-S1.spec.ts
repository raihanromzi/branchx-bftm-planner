import { expect, test } from "@playwright/test";
import { signInAsAdmin } from "./support/admin";

// E1-S1 criterion 5 (EC22): there is no endpoint that deletes a Funding Officer. Next.js answers 405
// for a method a Route Handler does not export; checked through the running app, signed in.
// A random id is used so the test leaves no data behind in the dev database.
test.describe("E1-S1 Funding Officers", () => {
  test("DELETE on the list and on a Funding Officer answers 405", async ({ page }) => {
    await signInAsAdmin(page);
    const id = "00000000-0000-4000-8000-000000000000";
    for (const path of ["/api/funding-officers", `/api/funding-officers/${id}`]) {
      const response = await page.request.delete(path);
      expect(response.status(), `DELETE ${path}`).toBe(405);
    }
    // The routes themselves exist for a signed-in Admin.
    expect((await page.request.get("/api/funding-officers")).status()).toBe(200);
  });
});
