import { expect, type Locator, type Page } from "@playwright/test";

// Responsive rules from DESIGN.md, shared by every story's end-to-end tests.

export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow, "page scrolls horizontally").toBeLessThanOrEqual(0);
}

export async function expectTouchTarget(locator: Locator, minSize = 44) {
  const box = await locator.boundingBox();
  expect(box, "element is not visible").not.toBeNull();
  expect(box!.width, "touch target too narrow").toBeGreaterThanOrEqual(minSize);
  expect(box!.height, "touch target too short").toBeGreaterThanOrEqual(minSize);
}
