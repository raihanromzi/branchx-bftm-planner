import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll } from "./support/responsive";

test.describe("E0-S1 scaffold", () => {
  test("home page loads in Bahasa Indonesia without horizontal scroll", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveTitle("BFTM Planner");
    await expect(page.locator("html")).toHaveAttribute("lang", "id");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("BFTM Planner");
    await expectNoHorizontalScroll(page);
  });
});
