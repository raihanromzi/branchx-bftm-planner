import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import { signInAsAdmin } from "./support/admin";
import { createFundingOfficer, deactivateFundingOfficer, e2eName, type FundingOfficerRecord } from "./support/funding-officers";
import { archiveProspect, createProspect, e2eLongName, PROSPECT_NAME_MAX } from "./support/prospects";
import { expectNoHorizontalScroll, expectTouchTarget } from "./support/responsive";

// E2-S2: the Prospect list. Signed in as the e2e Admin against the dev server's database.
//
// Parallel-safe: every test adds its own Funding Officer (unique e2e-marked name) and opens the list
// filtered to it (`?fo=<id>`), so other tests' Prospects never show. Until E3-S3 every row's `openPipeline`
// is null, so the Stage badge, the empty state, loading and errors replace only the GET /api/prospects
// response with page.route; the screen's own code still runs.

const SCREEN = "/prospect";
const COPY = {
  empty:
    "Belum ada Prospect. Prospect adalah sekolah, pasar, perusahaan, atau instansi yang ingin dibukakan rekening oleh tim Anda.",
  loadError: "Daftar Prospect gagal dimuat. Periksa koneksi, lalu coba lagi.",
};

const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1024;

/** The visible rows: the list below 1024 px, the table from 1024 px (the other one is display: none). */
const rows = (page: Page) => page.locator('[data-testid="prospect-row"]:visible');
const row = (page: Page, name: string) => rows(page).filter({ hasText: name });
const searchField = (page: Page) => page.getByRole("searchbox", { name: "Cari Prospect" });
const categorySelect = (page: Page) => page.getByRole("combobox", { name: "Kategori" });
const officerSelect = (page: Page) => page.getByRole("combobox", { name: "Funding Officer" });
/** The name tooltip in the table (a Base UI tooltip popup, which has no tooltip role). */
const tooltip = (page: Page) => page.locator('[data-slot="tooltip-content"]:visible');
const archiveToggle = (page: Page) => page.getByRole("button", { name: "Tampilkan arsip" });

/** The visible count ("51 Prospect"): in the header from 1024 px, under the filters below it. */
const count = (page: Page) => page.locator("p[aria-live=polite]:visible");

/** The primary action: the floating "Tambah" below 1024 px, the header link from 1024 px. */
function addAction(page: Page): Locator {
  return isDesktop(page)
    ? page.locator("header").getByRole("link", { name: "Tambah Prospect" })
    : page.getByRole("link", { name: "Tambah Prospect" }).filter({ hasText: /^Tambah$/ });
}

async function openList(page: Page, query = "") {
  await page.goto(`${SCREEN}${query}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Prospect");
}

const isListRequest = (url: URL) => url.pathname === "/api/prospects";

/**
 * A row as GET /api/prospects returns it. `openPipeline` uses the shape E3-S3 fills (api.md, Prospects
 * list row): `{ stageName, stagePosition, stageCount } | null`.
 */
function mockRow(name: string, overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    name,
    category: "sekolah",
    fundingOfficer: { id: crypto.randomUUID(), name: "Rina Kartika", active: true },
    hasLocation: true,
    potentialAccounts: 350,
    archived: false,
    openPipeline: null,
    ...overrides,
  };
}

const MOCK_ROWS = [
  mockRow("Kantor Kecamatan Tanah Sareal", {
    category: "instansi",
    fundingOfficer: { id: crypto.randomUUID(), name: "Agus Setiawan", active: true },
    potentialAccounts: 1250,
    openPipeline: { stageName: "Survei Lokasi", stagePosition: 1, stageCount: 7 },
  }),
  mockRow("Pasar Kramat Jati Blok B", {
    category: "pasar",
    fundingOfficer: { id: crypto.randomUUID(), name: "Agus Setiawan", active: true },
    hasLocation: false,
    potentialAccounts: null,
  }),
  mockRow("PT Sinar Logistik Nusantara", {
    category: "perusahaan",
    potentialAccounts: 820,
    openPipeline: { stageName: "Pembukaan Rekening", stagePosition: 5, stageCount: 5 },
  }),
  mockRow("SDN 3 Cibinong", { openPipeline: { stageName: "Presentasi", stagePosition: 3, stageCount: 5 } }),
];

async function mockList(page: Page, body: unknown) {
  await page.route(isListRequest, (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) }),
  );
}

async function expectResponsiveBasics(page: Page) {
  await expectNoHorizontalScroll(page);
  await expect(addAction(page)).toBeVisible();
  if (!isDesktop(page)) {
    await expectTouchTarget(searchField(page));
    await expectTouchTarget(categorySelect(page));
    await expectTouchTarget(officerSelect(page));
    await expectTouchTarget(archiveToggle(page));
    await expectTouchTarget(addAction(page));
  }
}

test.describe("E2-S2 Prospect list", () => {
  let officer: FundingOfficerRecord;

  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    officer = await createFundingOfficer(page, e2eName("Rina Kartika"));
  });

  test("criterion 1: 50 Prospects per page with name, Category, Funding Officer and 'Belum ada Pipeline'; page 2 in the URL", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const created = await Promise.all(
      Array.from({ length: 51 }, (_, index) =>
        createProspect(page, {
          name: e2eName(`SDN ${String(index + 1).padStart(2, "0")} Cibinong`),
          category: "sekolah",
          fundingOfficerId: officer.id,
          location: { lat: -6.4817, lng: 106.854 },
          potentialAccounts: 350,
        }),
      ),
    );
    const sorted = created.map((prospect) => prospect.name).sort((a, b) => a.localeCompare(b, "id"));

    await openList(page, `?fo=${officer.id}`);
    await expect(rows(page)).toHaveCount(50);
    await expect(count(page)).toHaveText("51 Prospect");
    await expect(page.getByText("Halaman 1 dari 2")).toBeVisible();

    const first = row(page, sorted[0]);
    await expect(first).toContainText(sorted[0]);
    await expect(first).toContainText("Sekolah");
    await expect(first).toContainText(officer.name);
    await expect(first).toContainText("Belum ada Pipeline");
    await expect(page.getByRole("link", { name: sorted[0], exact: true }).filter({ visible: true })).toHaveAttribute(
      "href",
      new RegExp(`^/prospect/${created.find((prospect) => prospect.name === sorted[0])!.id}$`),
    );

    await expectResponsiveBasics(page);
    if (!isDesktop(page)) {
      const box = await rows(page).first().boundingBox();
      expect(box!.height, "row at least 72 px").toBeGreaterThanOrEqual(72);
    }

    const nextPage = page.getByRole("button", { name: "Berikutnya" });
    if (!isDesktop(page)) await expectTouchTarget(nextPage);
    await nextPage.click();
    await expect(page).toHaveURL(/[?&]hal=2(&|$)/);
    await expect(rows(page)).toHaveCount(1);
    await expect(row(page, sorted[50])).toBeVisible();
    await expect(page.getByText("Halaman 2 dari 2")).toBeVisible();
    await expect(page.getByRole("button", { name: "Berikutnya" })).toBeDisabled();

    await page.reload();
    await expect(row(page, sorted[50])).toBeVisible();
    await page.getByRole("button", { name: "Sebelumnya" }).click();
    await expect(page).not.toHaveURL(/hal=/);
    await expect(rows(page)).toHaveCount(50);
  });

  test("criterion 1, EC45: the open Pipeline's Stage shows as a badge with its accessible name, not truncated", async ({
    page,
  }) => {
    await mockList(page, { items: MOCK_ROWS, page: 1, pageSize: 50, total: 4 });
    await openList(page);

    const presentasi = page.getByRole("img", { name: "Presentasi, tahap 3 dari 5" }).filter({ visible: true });
    await expect(presentasi).toBeVisible();
    await expect(presentasi).toHaveAttribute("data-stage-bucket", "3");
    await expect(row(page, "SDN 3 Cibinong")).toContainText("Presentasi");

    const survei = page.getByRole("img", { name: "Survei Lokasi, tahap 1 dari 7" }).filter({ visible: true });
    await expect(survei).toHaveAttribute("data-stage-bucket", "1");

    const pembukaan = page.getByRole("img", { name: "Pembukaan Rekening, tahap 5 dari 5" }).filter({ visible: true });
    await expect(pembukaan).toHaveAttribute("data-stage-bucket", "5");
    // The whole 18-character name is shown: nothing is clipped and no ellipsis is drawn.
    const stageName = pembukaan.locator('[data-slot="stage-name"]');
    await expect(stageName).toHaveText("Pembukaan Rekening");
    const clipped = await stageName.evaluate((element) => {
      const style = getComputedStyle(element);
      return element.scrollWidth > element.clientWidth || style.textOverflow === "ellipsis";
    });
    expect(clipped, "Stage name is truncated").toBe(false);

    await expect(row(page, "Pasar Kramat Jati Blok B")).toContainText("Belum ada Pipeline");
    await expectNoHorizontalScroll(page);
  });

  test("criterion 2: search, Category and Funding Officer filters update the list, live in the URL and survive a reload", async ({
    page,
  }) => {
    const sdn = await createProspect(page, { name: e2eName("SDN 3 Cibinong"), category: "sekolah", fundingOfficerId: officer.id });
    const kramat = await createProspect(page, { name: e2eName("Pasar Kramat Jati Blok B"), category: "pasar", fundingOfficerId: officer.id });
    const anyar = await createProspect(page, { name: e2eName("Pasar Anyar Kota Bogor"), category: "pasar", fundingOfficerId: officer.id });

    await openList(page);
    await officerSelect(page).selectOption({ label: officer.name });
    await expect(page).toHaveURL(new RegExp(`[?&]fo=${officer.id}`));
    await expect(rows(page)).toHaveCount(3);

    await categorySelect(page).selectOption({ label: "Pasar" });
    await expect(page).toHaveURL(/[?&]kategori=pasar/);
    await expect(rows(page)).toHaveCount(2);
    await expect(row(page, sdn.name)).toHaveCount(0);

    await searchField(page).fill("kramat");
    await expect(page).toHaveURL(/[?&]q=kramat/);
    await expect(rows(page)).toHaveCount(1);
    await expect(row(page, kramat.name)).toBeVisible();
    await expect(row(page, anyar.name)).toHaveCount(0);

    await page.reload();
    await expect(searchField(page)).toHaveValue("kramat");
    await expect(categorySelect(page)).toHaveValue("pasar");
    await expect(officerSelect(page)).toHaveValue(officer.id);
    await expect(rows(page)).toHaveCount(1);
    await expect(row(page, kramat.name)).toBeVisible();

    // A filter change goes back to page 1 and keeps the search.
    await categorySelect(page).selectOption({ label: "Semua kategori" });
    await expect(page).not.toHaveURL(/kategori=/);
    await expect(page).toHaveURL(/[?&]q=kramat/);
    await expect(rows(page)).toHaveCount(1);
    await expectResponsiveBasics(page);
  });

  test("criterion 3, EC34: a Prospect without a location is marked 'Belum ada lokasi'", async ({ page }) => {
    const without = await createProspect(page, { name: e2eName("Pasar Kramat Jati Blok B"), category: "pasar", fundingOfficerId: officer.id });
    const withLocation = await createProspect(page, {
      name: e2eName("SDN 3 Cibinong"),
      category: "sekolah",
      fundingOfficerId: officer.id,
      location: { lat: -6.4817, lng: 106.854 },
    });
    await openList(page, `?fo=${officer.id}`);

    await expect(row(page, without.name)).toContainText("Belum ada lokasi");
    await expect(row(page, withLocation.name)).not.toContainText("Belum ada lokasi");
    if (isDesktop(page)) {
      await expect(row(page, without.name).getByRole("cell").nth(5)).toContainText("Belum ada");
      await expect(row(page, withLocation.name).getByRole("cell").nth(5)).toHaveText("Ada");
    }
  });

  test("criterion 4, EC7: a 150-character name wraps on mobile and is truncated with the full name on hover and focus on desktop", async ({
    page,
  }) => {
    const name = e2eLongName();
    expect(name).toHaveLength(PROSPECT_NAME_MAX);
    await createProspect(page, { name, category: "komunitas", fundingOfficerId: officer.id });
    await openList(page, `?fo=${officer.id}`);

    const link = page.getByRole("link", { name, exact: true }).filter({ visible: true });
    await expect(link).toBeVisible();
    await expectNoHorizontalScroll(page);

    if (!isDesktop(page)) {
      // Wraps over several 24 px lines, all of it on screen.
      const height = await link.evaluate((element) => element.getBoundingClientRect().height);
      expect(height, "name wraps").toBeGreaterThanOrEqual(48);
      await expect(link).toHaveText(name);
      const box = await link.boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    } else {
      const truncated = await link.evaluate((element) => ({
        cut: element.scrollWidth > element.clientWidth,
        ellipsis: getComputedStyle(element).textOverflow,
        height: element.getBoundingClientRect().height,
      }));
      expect(truncated.cut, "name is cut to one line").toBe(true);
      expect(truncated.ellipsis).toBe("ellipsis");
      expect(truncated.height).toBeLessThan(30);

      await link.hover();
      await expect(tooltip(page)).toHaveText(name);
      await page.mouse.move(0, 0);
      await expect(tooltip(page)).toHaveCount(0);

      await searchField(page).focus();
      // Tab through the filters to the name link: focus alone shows the full name.
      for (let step = 0; step < 6 && !(await link.evaluate((element) => element === document.activeElement)); step += 1) {
        await page.keyboard.press("Tab");
      }
      await expect(link).toBeFocused();
      await expect(tooltip(page)).toHaveText(name);
    }
  });

  test("criterion 5: with no Prospects the list explains what a Prospect is and offers 'Tambah Prospect'", async ({ page }) => {
    await mockList(page, { items: [], page: 1, pageSize: 50, total: 0 });
    await openList(page);
    await expect(page.getByText(COPY.empty, { exact: true })).toBeVisible();
    const add = page.getByRole("main").getByRole("link", { name: "Tambah Prospect" }).filter({ visible: true }).first();
    await expect(add).toBeVisible();
    await expect(add).toHaveAttribute("href", "/prospect/baru");
    if (!isDesktop(page)) await expectTouchTarget(add);
    await expectNoHorizontalScroll(page);

    await add.click();
    await expect(page).toHaveURL(/\/prospect\/baru$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tambah Prospect");
  });

  test("criterion 5: with no search results it says nothing matched, and 'Hapus filter' clears search and filters", async ({
    page,
  }) => {
    const prospect = await createProspect(page, { name: e2eName("SDN 3 Cibinong"), category: "sekolah", fundingOfficerId: officer.id });
    await openList(page, `?fo=${officer.id}&kategori=sekolah`);
    await expect(row(page, prospect.name)).toBeVisible();

    await searchField(page).fill("kramat");
    await expect(page.getByText('Tidak ada Prospect yang cocok dengan "kramat".', { exact: true })).toBeVisible();
    await expect(rows(page)).toHaveCount(0);
    const clear = page.getByRole("button", { name: "Hapus filter" });
    if (!isDesktop(page)) await expectTouchTarget(clear);

    await clear.click();
    await expect(page).toHaveURL(/\/prospect$/);
    await expect(searchField(page)).toHaveValue("");
    await expect(categorySelect(page)).toHaveValue("");
    await expect(officerSelect(page)).toHaveValue("");
    await expect(page.getByText(/Tidak ada Prospect yang cocok/)).toHaveCount(0);
  });

  test("criterion 6: 'Tampilkan arsip' shows archived Prospects, each labelled 'Diarsipkan'", async ({ page }) => {
    const active = await createProspect(page, { name: e2eName("SDN 3 Cibinong"), category: "sekolah", fundingOfficerId: officer.id });
    const archived = await archiveProspect(
      page,
      await createProspect(page, { name: e2eName("PT Sinar Logistik Nusantara"), category: "perusahaan", fundingOfficerId: officer.id }),
    );

    await openList(page, `?fo=${officer.id}`);
    await expect(row(page, active.name)).toBeVisible();
    await expect(row(page, archived.name)).toHaveCount(0);
    await expect(archiveToggle(page)).toHaveAttribute("aria-pressed", "false");

    await archiveToggle(page).click();
    await expect(page).toHaveURL(/[?&]arsip=1/);
    await expect(archiveToggle(page)).toHaveAttribute("aria-pressed", "true");
    await expect(row(page, archived.name)).toBeVisible();
    await expect(row(page, archived.name)).toContainText("Diarsipkan");
    await expect(row(page, active.name)).not.toContainText("Diarsipkan");

    await page.reload();
    await expect(row(page, archived.name)).toContainText("Diarsipkan");
    await archiveToggle(page).click();
    await expect(page).not.toHaveURL(/arsip=/);
    await expect(row(page, archived.name)).toHaveCount(0);
  });

  test("an inactive Funding Officer is labelled 'Funding Officer nonaktif' on the row", async ({ page }) => {
    const prospect = await createProspect(page, { name: e2eName("Kantor Kecamatan Tanah Sareal"), category: "instansi", fundingOfficerId: officer.id });
    await deactivateFundingOfficer(page, officer);
    await openList(page, `?fo=${officer.id}`);
    await expect(row(page, prospect.name)).toContainText("Funding Officer nonaktif");
  });

  test("a row opens the Prospect, and the loading and error states show with 'Coba lagi' working", async ({ page }) => {
    const prospect = await createProspect(page, { name: e2eName("SDN 3 Cibinong"), category: "sekolah", fundingOfficerId: officer.id });

    // Every list request waits, then fails, until "Coba lagi" is about to be tapped. (In development React
    // runs effects twice, so the first request may be replaced by a second one.)
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let failing = true;
    await page.route(isListRequest, async (route) => {
      if (!failing) return route.continue();
      await held;
      await route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
    });
    await openList(page, `?fo=${officer.id}`);
    await expect(page.getByTestId("prospect-skeleton")).toBeVisible();
    release();

    await expect(page.getByText(COPY.loadError, { exact: true })).toBeVisible();
    const retry = page.getByRole("button", { name: "Coba lagi" });
    if (!isDesktop(page)) await expectTouchTarget(retry);
    failing = false;
    await retry.click();
    await expect(row(page, prospect.name)).toBeVisible();

    await page.getByRole("link", { name: prospect.name, exact: true }).filter({ visible: true }).click();
    await expect(page).toHaveURL(new RegExp(`/prospect/${prospect.id}$`));
    // E2-S4 replaced the placeholder: the detail page shows the Prospect's name as a heading.
    await expect(page.getByRole("heading", { name: prospect.name, exact: true })).toBeVisible();
  });
});
