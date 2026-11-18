import { expect, test, type Page } from "@playwright/test";
import { E2E_ADMIN, signInAsAdmin } from "./support/admin";
import { expectNoHorizontalScroll, expectTouchTarget } from "./support/responsive";

// E0-S4: the app shell, its navigation, the design tokens and the web app manifest.

const MAIN = ["Dasbor", "Prospect", "Jadwal", "Peta"];
const SETTINGS = ["Funding Officer", "Template Pipeline", "Target"];

const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1024;
const mainNav = (page: Page) => page.getByRole("navigation", { name: "Navigasi utama" });

test.describe("E0-S4 app shell", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test("criterion 1: bottom nav on mobile and tablet, sidebar with Pengaturan on desktop", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Dasbor");
    const nav = mainNav(page);
    await expect(nav).toHaveCount(1);
    await expect(nav).toBeVisible();

    if (isDesktop(page)) {
      for (const label of [...MAIN, ...SETTINGS]) {
        await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
      }
      await expect(nav.getByText("Pengaturan", { exact: true })).toBeVisible();
      await expect(nav.getByRole("button", { name: "Lainnya" })).toHaveCount(0);
      await expect(page.getByText(E2E_ADMIN.email)).toBeVisible();
    } else {
      const box = await nav.boundingBox();
      const viewport = page.viewportSize()!;
      expect(box!.y + box!.height).toBeCloseTo(viewport.height, 0);
      for (const label of MAIN) {
        await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
      }
      await expect(nav.getByRole("button", { name: "Lainnya" })).toBeVisible();
      // The settings screens live behind "Lainnya", not in the bar.
      for (const label of SETTINGS) await expect(nav.getByRole("link", { name: label })).toHaveCount(0);
      await expect(page.getByText("BFTM Planner", { exact: true })).toBeHidden();
    }
  });

  test("criterion 2: the current destination has aria-current and a non-colour indicator", async ({ page }) => {
    await page.goto("/prospect");
    const nav = mainNav(page);
    const current = nav.getByRole("link", { name: "Prospect", exact: true });
    const other = nav.getByRole("link", { name: "Jadwal", exact: true });
    await expect(current).toHaveAttribute("aria-current", "page");
    await expect(other).not.toHaveAttribute("aria-current", /.*/);
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);

    // Weight: 600 on the current item, 500 on the others.
    expect(await current.evaluate((el) => getComputedStyle(el).fontWeight)).toBe("600");
    expect(await other.evaluate((el) => getComputedStyle(el).fontWeight)).toBe("500");

    if (isDesktop(page)) {
      // A 3 px bar on the left of the current row only.
      expect(await current.evaluate((el) => getComputedStyle(el, "::before").width)).toBe("3px");
      expect(await other.evaluate((el) => getComputedStyle(el, "::before").content)).toBe("none");
    } else {
      // A tinted pill behind the current item's icon only.
      const pill = (el: Element) => getComputedStyle(el.querySelector("span[aria-hidden]")!).backgroundColor;
      expect(await current.evaluate(pill)).toBe("rgb(230, 242, 242)");
      expect(await other.evaluate(pill)).toBe("rgba(0, 0, 0, 0)");
    }
  });

  test("criterion 1: every destination is reachable and opens its screen", async ({ page }) => {
    await page.goto("/");
    const nav = mainNav(page);
    for (const [label, path] of [
      ["Prospect", "/prospect"],
      ["Jadwal", "/jadwal"],
      ["Peta", "/peta"],
      ["Dasbor", "/"],
    ] as const) {
      await nav.getByRole("link", { name: label, exact: true }).click();
      await expect(page).toHaveURL(path);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(label);
      await expect(nav.getByRole("link", { name: label, exact: true })).toHaveAttribute("aria-current", "page");
    }

    for (const [label, path] of [
      ["Funding Officer", "/pengaturan/funding-officer"],
      ["Template Pipeline", "/pengaturan/template-pipeline"],
      ["Target", "/pengaturan/target"],
    ] as const) {
      if (!isDesktop(page)) await nav.getByRole("button", { name: "Lainnya" }).click();
      const scope = isDesktop(page) ? nav : page.getByRole("dialog", { name: "Lainnya" });
      await scope.getByRole("link", { name: label, exact: true }).click();
      await expect(page).toHaveURL(path);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(label);
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
    if (!isDesktop(page)) {
      // On a Pengaturan screen, "Lainnya" is the current item.
      await expect(nav.getByRole("button", { name: "Lainnya" })).toHaveAttribute("aria-current", "page");
    }
  });

  test("criterion 6: Lainnya on mobile and tablet holds Pengaturan and Keluar", async ({ page }) => {
    test.skip(isDesktop(page), "the sidebar shows Pengaturan and Keluar directly");
    await page.goto("/");
    await mainNav(page).getByRole("button", { name: "Lainnya" }).click();
    const sheet = page.getByRole("dialog", { name: "Lainnya" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText("Pengaturan", { exact: true })).toBeVisible();
    for (const label of SETTINGS) {
      const link = sheet.getByRole("link", { name: label, exact: true });
      await expect(link).toBeVisible();
      await expectTouchTarget(link);
    }
    await expectTouchTarget(sheet.getByRole("button", { name: "Keluar" }));
    await expectTouchTarget(sheet.getByRole("button", { name: "Tutup" }));
    await sheet.getByRole("button", { name: "Tutup" }).click();
    await expect(sheet).toHaveCount(0);
  });

  test("criterion 6: Keluar signs out, lands on /masuk, and the session no longer works", async ({ page }) => {
    await page.goto("/jadwal");
    let signOut;
    if (isDesktop(page)) {
      signOut = mainNav(page).locator("..").getByRole("button", { name: "Keluar" });
    } else {
      await mainNav(page).getByRole("button", { name: "Lainnya" }).click();
      signOut = page.getByRole("dialog", { name: "Lainnya" }).getByRole("button", { name: "Keluar" });
    }
    // Hold the request so the pending label can be seen.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/auth/sign-out", async (route) => {
      await held;
      await route.continue();
    });
    await signOut.click();
    await expect(page.getByRole("button", { name: "Keluar…" })).toBeDisabled();
    release();

    await expect(page).toHaveURL("/masuk");
    expect((await page.request.get("/api/auth/me")).status()).toBe(401);
    // Back to a signed-in page: sent to sign in again.
    await page.goto("/jadwal");
    await expect(page).toHaveURL("/masuk?next=%2Fjadwal");
  });

  test("criterion 3: Plus Jakarta Sans, the teal accent and the 6 px radius are applied", async ({ page }) => {
    await page.goto("/");
    const styles = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      return {
        font: getComputedStyle(document.body).fontFamily,
        primary: root.getPropertyValue("--primary").trim().toLowerCase(),
        radius: root.getPropertyValue("--radius").trim(),
        surface: root.getPropertyValue("--surface").trim().toLowerCase(),
      };
    });
    expect(styles.font).toContain("Plus Jakarta Sans");
    expect(styles.primary).toBe("#0e6e73");
    expect(styles.radius).toBe("6px");
    expect(styles.surface).toBe("#f5f6f7");
    const current = mainNav(page).locator('[aria-current="page"]');
    expect(await current.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(14, 110, 115)");
  });

  test("responsive: no horizontal scroll, 44 px targets, and content clears the bottom nav", async ({ page }) => {
    await page.goto("/pengaturan/template-pipeline");
    await expectNoHorizontalScroll(page);
    if (isDesktop(page)) return;

    const nav = mainNav(page);
    for (const label of MAIN) await expectTouchTarget(nav.getByRole("link", { name: label, exact: true }));
    await expectTouchTarget(nav.getByRole("button", { name: "Lainnya" }));

    const navHeight = (await nav.boundingBox())!.height;
    const padding = await page.locator("main").evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom));
    expect(padding).toBeGreaterThanOrEqual(navHeight - 1);
  });

  test("the skip link is the first focusable element on desktop", async ({ page }) => {
    test.skip(!isDesktop(page), "desktop only, per the design");
    await page.goto("/");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Lewati ke konten" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    const outline = await skip.evaluate((el) => getComputedStyle(el).outlineWidth);
    expect(outline).toBe("2px");
  });
});

test.describe("E0-S4 installable without a session (criterion 4)", () => {
  test("the manifest is served with its fields, and every icon is a PNG", async ({ request, page }) => {
    const response = await request.get("/manifest.webmanifest");
    expect(response.status()).toBe(200);
    const manifest = await response.json();
    expect(manifest).toMatchObject({
      name: "BFTM Planner",
      start_url: "/",
      display: "standalone",
      theme_color: "#0E6E73",
      background_color: "#FFFFFF",
    });
    expect(manifest.icons.map((icon: { sizes: string }) => icon.sizes)).toEqual(["192x192", "512x512", "512x512"]);
    for (const icon of manifest.icons as { src: string }[]) {
      const image = await request.get(icon.src);
      expect(image.status(), icon.src).toBe(200);
      expect(image.headers()["content-type"]).toBe("image/png");
    }

    // The page links the manifest, and registers no service worker (online only).
    await page.goto("/masuk");
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", /manifest\.webmanifest/);
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#0E6E73");
    const registrations = await page.evaluate(async () =>
      "serviceWorker" in navigator ? (await navigator.serviceWorker.getRegistrations()).length : 0,
    );
    expect(registrations).toBe(0);
  });
});
