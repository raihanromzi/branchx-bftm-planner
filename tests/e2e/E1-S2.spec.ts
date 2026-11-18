import { expect, test, type Locator, type Page } from "@playwright/test";
import { signInAsAdmin } from "./support/admin";
import {
  createFundingOfficer,
  deactivateFundingOfficer,
  e2eName,
  type FundingOfficerRecord,
} from "./support/funding-officers";
import { expectNoHorizontalScroll, expectTouchTarget } from "./support/responsive";

// E1-S2: Pengaturan → Funding Officer. Signed in as the e2e Admin against the dev server's database.
// Every test adds its own Funding Officers with a unique name (support/funding-officers.ts), so tests
// run in parallel and never depend on rows they did not create.
//
// The list is read on the client from GET /api/funding-officers. The empty, loading and error states
// replace only that response with page.route: the screen's own code and the real add form still run.
// An empty database cannot be relied on, since other tests add Funding Officers at the same time.

const SCREEN = "/pengaturan/funding-officer";
const COPY = {
  empty:
    "Belum ada Funding Officer. Prospect, Pipeline, dan Kegiatan ditugaskan ke Funding Officer, jadi tambahkan tim Anda dulu.",
  loadError: "Daftar Funding Officer gagal dimuat.",
  phoneError: "Nomor telepon tidak valid. Contoh: 0812 3456 7890",
  conflict: "Data ini sudah diubah. Muat ulang untuk melihat versi terbaru.",
};

const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1024;

/** The row of a Funding Officer: a list row below 1024 px, a table row from 1024 px. */
function row(page: Page, name: string): Locator {
  return isDesktop(page)
    ? page.getByRole("row").filter({ hasText: name })
    : page.getByRole("list", { name: "Daftar Funding Officer" }).getByRole("listitem").filter({ hasText: name });
}

/** The primary action: the floating "Tambah" below 1024 px, the header button from 1024 px. */
function addButton(page: Page): Locator {
  return isDesktop(page)
    ? page.locator("header").getByRole("button", { name: "Tambah Funding Officer" })
    : page.getByRole("button", { name: "Tambah", exact: true });
}

/** Runs a row action: from the ⋯ menu below 1024 px, from the row's own button from 1024 px. */
async function rowAction(page: Page, name: string, action: "Ubah" | "Nonaktifkan" | "Aktifkan lagi") {
  if (isDesktop(page)) {
    await page.getByRole("button", { name: `${action} ${name}`, exact: true }).click();
  } else {
    await page.getByRole("button", { name: `Aksi untuk ${name}`, exact: true }).click();
    await page.getByRole("menuitem", { name: action, exact: true }).click();
  }
}

const dialog = (page: Page) => page.getByRole("dialog");
const nameField = (page: Page) => dialog(page).getByLabel("Nama", { exact: true });
const phoneField = (page: Page) => dialog(page).getByLabel("Telepon", { exact: true });
const saveButton = (page: Page) => dialog(page).getByRole("button", { name: "Simpan", exact: true });

async function openScreen(page: Page) {
  await page.goto(SCREEN);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Funding Officer");
}

test.describe("E1-S2 Funding Officer screen", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    // At least one Funding Officer, so the list (not the empty state) shows even when this test runs alone.
    await createFundingOfficer(page, e2eName("Lina Marlina"));
  });

  test("criterion 1: lists name, local-format phone and a Nonaktif label for inactive ones", async ({ page }) => {
    const active = await createFundingOfficer(page, e2eName("Rina Kartika"), "+62 812-3456-7890");
    const inactive = await deactivateFundingOfficer(
      page,
      await createFundingOfficer(page, e2eName("Dedi Pratama"), "0857 9988 7766"),
    );
    await openScreen(page);

    const activeRow = row(page, active.name);
    await expect(activeRow).toContainText(active.name);
    const phone = activeRow.getByRole("link", { name: "0812-3456-7890" });
    await expect(phone).toHaveAttribute("href", "tel:+6281234567890");
    await expect(activeRow.getByText("Nonaktif", { exact: true })).toHaveCount(0);

    const inactiveRow = row(page, inactive.name);
    await expect(inactiveRow.getByRole("link", { name: "0857-9988-7766" })).toBeVisible();
    // A text label, not colour alone.
    await expect(inactiveRow.getByText("Nonaktif", { exact: true })).toBeVisible();

    // Active Funding Officers come before inactive ones.
    const names = await (isDesktop(page)
      ? page.getByRole("row")
      : page.getByRole("list", { name: "Daftar Funding Officer" }).getByRole("listitem")
    ).allInnerTexts();
    const activeIndex = names.findIndex((text) => text.includes(active.name));
    const inactiveIndex = names.findIndex((text) => text.includes(inactive.name));
    expect(activeIndex).toBeGreaterThanOrEqual(0);
    expect(activeIndex).toBeLessThan(inactiveIndex);

    await expectNoHorizontalScroll(page);
    await expect(addButton(page)).toBeInViewport();
    if (isDesktop(page)) {
      await expect(page.getByRole("table")).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Nama" })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Telepon" })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Status" })).toBeVisible();
    } else {
      await expectTouchTarget(addButton(page), 56);
      await expectTouchTarget(page.getByRole("button", { name: `Aksi untuk ${active.name}`, exact: true }));
      await expectTouchTarget(phone);
      // The floating button sits above the bottom navigation, not over it.
      const fab = (await addButton(page).boundingBox())!;
      const nav = (await page.getByRole("navigation", { name: "Navigasi utama" }).boundingBox())!;
      expect(fab.y + fab.height).toBeLessThanOrEqual(nav.y);
    }
  });

  test("a 100-character name wraps without a horizontal scroll", async ({ page }) => {
    const base = "Raden Ajeng Siti Nurhaliza Kusumawardhani Prameswari Wicaksono Hadiningrat Putri Sekar Arum Dalu";
    const marker = e2eName(""); // " e2e-<id>"
    const name = `${base.slice(0, 100 - marker.length).replace(/ $/, "a")}${marker}`;
    expect(name).toHaveLength(100);
    const officer = await createFundingOfficer(page, name);
    await openScreen(page);
    await expect(row(page, officer.name)).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("criterion 2: the Admin adds a Funding Officer and it appears in the list", async ({ page }) => {
    const name = e2eName("Agus Setiawan");
    await openScreen(page);
    await addButton(page).click();
    await expect(dialog(page).getByRole("heading", { name: "Tambah Funding Officer" })).toBeVisible();
    await expect(phoneField(page)).toHaveAttribute("type", "tel");
    await expect(phoneField(page)).toHaveAttribute("inputmode", "tel");

    await nameField(page).fill(name);
    await phoneField(page).fill("0813 1122 3344");
    const created = page.waitForResponse(
      (response) => response.url().endsWith("/api/funding-officers") && response.request().method() === "POST",
    );
    await saveButton(page).click();
    const response = await created;
    expect(response.status()).toBe(201);
    expect(response.request().headers()["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);

    await expect(dialog(page)).toHaveCount(0);
    await expect(row(page, name)).toContainText("0813-1122-3344");
    // It is really stored: still there after a reload.
    await page.reload();
    await expect(row(page, name)).toContainText("0813-1122-3344");
  });

  test("criterion 2, EC11: an invalid phone shows the server's message under Telepon", async ({ page }) => {
    await openScreen(page);
    await addButton(page).click();
    await nameField(page).fill(e2eName("Siti Rahma"));
    await phoneField(page).fill("12345");
    const answer = page.waitForResponse(
      (response) => response.url().endsWith("/api/funding-officers") && response.request().method() === "POST",
    );
    await saveButton(page).click();
    const response = await answer;
    expect(response.status()).toBe(400);
    expect((await response.json()).error.fields.phone).toBe(COPY.phoneError);

    await expect(phoneField(page)).toHaveAttribute("aria-invalid", "true");
    await expect(phoneField(page)).toHaveAccessibleDescription(COPY.phoneError);
    await expect(dialog(page).getByText(COPY.phoneError, { exact: true })).toBeVisible();
    await expect(phoneField(page)).toBeFocused();
    // The input is kept, and the form stays open.
    await expect(phoneField(page)).toHaveValue("12345");
    await expectNoHorizontalScroll(page);
  });

  test("criterion 2: the Admin edits a Funding Officer's name", async ({ page }) => {
    const officer = await createFundingOfficer(page, e2eName("Budi Santoso"));
    const renamed = e2eName("Budi Santoso Putra");
    await openScreen(page);
    await rowAction(page, officer.name, "Ubah");
    await expect(dialog(page).getByRole("heading", { name: "Ubah Funding Officer" })).toBeVisible();
    await expect(nameField(page)).toHaveValue(officer.name);
    await expect(phoneField(page)).toHaveValue("0812-3456-7890");

    await nameField(page).fill(renamed);
    await saveButton(page).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(row(page, renamed)).toBeVisible();
    await expect(row(page, officer.name)).toHaveCount(0);
  });

  test("criterion 3: the Admin deactivates after confirming, then reactivates", async ({ page }) => {
    const officer = await createFundingOfficer(page, e2eName("Rina Kartika"));
    await openScreen(page);
    await expect(row(page, officer.name).getByText("Nonaktif", { exact: true })).toHaveCount(0);

    await rowAction(page, officer.name, "Nonaktifkan");
    await expect(dialog(page)).toContainText(`Nonaktifkan ${officer.name}?`);
    await expect(dialog(page)).toContainText("Ia tidak bisa ditugaskan pekerjaan baru.");
    // "Batal" changes nothing.
    await dialog(page).getByRole("button", { name: "Batal" }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(row(page, officer.name).getByText("Nonaktif", { exact: true })).toHaveCount(0);

    await rowAction(page, officer.name, "Nonaktifkan");
    await dialog(page).getByRole("button", { name: "Nonaktifkan", exact: true }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(row(page, officer.name).getByText("Nonaktif", { exact: true })).toBeVisible();

    await rowAction(page, officer.name, "Aktifkan lagi");
    await expect(row(page, officer.name).getByText("Nonaktif", { exact: true })).toHaveCount(0);
    await page.reload();
    await expect(row(page, officer.name)).toBeVisible();
    await expect(row(page, officer.name).getByText("Nonaktif", { exact: true })).toHaveCount(0);
  });

  test("EC15: Simpan is disabled while saving, and one key is sent per form open", async ({ page }) => {
    const name = e2eName("Wahyu Hidayat");
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const keys: string[] = [];
    await page.route("**/api/funding-officers", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      keys.push(route.request().headers()["idempotency-key"]);
      await held;
      await route.continue();
    });
    await openScreen(page);
    await addButton(page).click();
    await nameField(page).fill(name);
    await phoneField(page).fill("0812 7777 8888");
    await saveButton(page).click();

    await expect(saveButton(page)).toBeDisabled();
    await expect(nameField(page)).toHaveAttribute("readonly", "");
    // A second press while saving sends nothing.
    await saveButton(page).click({ force: true });
    expect(keys).toHaveLength(1);

    release();
    await expect(dialog(page)).toHaveCount(0);
    await expect(row(page, name)).toBeVisible();
  });

  test("EC18: a Funding Officer changed meanwhile shows the reload message, and Muat ulang loads it", async ({ page }) => {
    const officer = await createFundingOfficer(page, e2eName("Dewi Lestari"));
    const changedElsewhere = e2eName("Dewi Lestari Sari");
    await openScreen(page);
    await rowAction(page, officer.name, "Ubah");
    await expect(nameField(page)).toHaveValue(officer.name);

    // Someone else saves first: version 1 becomes 2.
    const other = await page.request.patch(`/api/funding-officers/${officer.id}`, {
      data: { name: changedElsewhere, version: officer.version },
    });
    expect(other.status()).toBe(200);

    await nameField(page).fill(e2eName("Dewi Lestari Baru"));
    await saveButton(page).click();
    const alert = dialog(page).getByRole("alert");
    await expect(alert).toContainText(COPY.conflict);
    await alert.getByRole("button", { name: "Muat ulang" }).click();
    await expect(dialog(page).getByRole("alert")).toHaveCount(0);
    await expect(nameField(page)).toHaveValue(changedElsewhere);

    // With the latest version loaded, saving works.
    const final = e2eName("Dewi Lestari Akhir");
    await nameField(page).fill(final);
    await saveButton(page).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(row(page, final)).toBeVisible();
  });

  test("EC18: deactivating a Funding Officer changed meanwhile shows the reload message", async ({ page }) => {
    const officer: FundingOfficerRecord = await createFundingOfficer(page, e2eName("Hendra Gunawan"));
    await openScreen(page);
    // The screen has loaded version 1 before someone else saves version 2.
    await expect(row(page, officer.name)).toBeVisible();
    const other = await page.request.patch(`/api/funding-officers/${officer.id}`, {
      data: { phone: "0812 0000 1111", version: officer.version },
    });
    expect(other.status()).toBe(200);

    await rowAction(page, officer.name, "Nonaktifkan");
    await dialog(page).getByRole("button", { name: "Nonaktifkan", exact: true }).click();
    await expect(dialog(page).getByRole("alert")).toContainText(COPY.conflict);
    await dialog(page).getByRole("button", { name: "Muat ulang" }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(row(page, officer.name)).toContainText("0812-0000-1111");
    await expect(row(page, officer.name).getByText("Nonaktif", { exact: true })).toHaveCount(0);
  });

  test("criterion 4: with no Funding Officers, the screen explains and offers Tambah Funding Officer", async ({ page }) => {
    await page.route("**/api/funding-officers", (route) =>
      route.request().method() === "GET"
        ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) })
        : route.continue(),
    );
    await openScreen(page);
    await expect(page.getByText(COPY.empty, { exact: true })).toBeVisible();
    const add = page.getByRole("main").getByRole("button", { name: "Tambah Funding Officer" });
    await expect(add).toBeVisible();
    // One primary action: no floating button and no header button next to it.
    await expect(page.getByRole("button", { name: "Tambah", exact: true })).toHaveCount(0);
    await expect(page.locator("header").getByRole("button")).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    if (!isDesktop(page)) await expectTouchTarget(add);

    await add.click();
    await expect(dialog(page).getByRole("heading", { name: "Tambah Funding Officer" })).toBeVisible();
  });

  test("loading shows skeleton rows; a failed load says so and Coba lagi loads the list", async ({ page }) => {
    const officer = await createFundingOfficer(page, e2eName("Yusuf Maulana"));
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/funding-officers", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await held;
      await route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
    });
    await openScreen(page);
    await expect(page.getByTestId("fo-skeleton")).toBeVisible();

    release();
    await expect(page.getByText(COPY.loadError, { exact: true })).toBeVisible();
    await expect(page.getByTestId("fo-skeleton")).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    const retry = page.getByRole("button", { name: "Coba lagi" });
    if (!isDesktop(page)) await expectTouchTarget(retry);

    await page.unroute("**/api/funding-officers");
    await retry.click();
    await expect(row(page, officer.name)).toBeVisible();
    await expect(page.getByText(COPY.loadError, { exact: true })).toHaveCount(0);
  });

  test("the focus ring is a 2 px outline on an Input and a Button", async ({ page }) => {
    await openScreen(page);
    await addButton(page).click();
    await expect(nameField(page)).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(phoneField(page)).toBeFocused();
    await expectFocusRing(phoneField(page));
    await page.keyboard.press("Tab");
    const cancel = dialog(page).getByRole("button", { name: "Batal" });
    await expect(cancel).toBeFocused();
    await expectFocusRing(cancel);
  });
});

async function expectFocusRing(locator: Locator) {
  // Polled: the Button's transition-all animates the outline in over 150 ms.
  await expect
    .poll(() =>
      locator.evaluate((element) => {
        const computed = getComputedStyle(element);
        return { width: computed.outlineWidth, style: computed.outlineStyle, offset: computed.outlineOffset };
      }),
    )
    .toEqual({ width: "2px", style: "solid", offset: "2px" });
}
