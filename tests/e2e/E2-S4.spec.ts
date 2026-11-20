import { expect, test, type Page, type Route } from "@playwright/test";
import { signInAsAdmin } from "./support/admin";
import { createFundingOfficer, deactivateFundingOfficer, e2eName, type FundingOfficerRecord } from "./support/funding-officers";
import { archiveProspect, createProspect, e2eLongName } from "./support/prospects";
import { expectNoHorizontalScroll, expectTouchTarget } from "./support/responsive";

// E2-S4: the Prospect detail. Signed in as the e2e Admin against the dev server's database. Every Funding
// Officer, Prospect and template carries the e2e marker (global-setup.ts removes them, with their Pipelines).
// Pipelines and Activities are made through the real API; map tiles are answered with a blank image.

const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1024;
const BLANK_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

const COPY = {
  blocked: "Tutup atau tunda Pipeline dulu.",
  noOpenPipeline: "Belum ada Pipeline berjalan.",
  noActivities: "Belum ada Kegiatan untuk Prospect ini.",
  notFound: "Prospect tidak ditemukan. Mungkin alamatnya salah.",
  loadError: "Data Prospect gagal dimuat.",
};

/** Blank map tiles, so no test loads OpenStreetMap. */
async function stubTiles(page: Page) {
  await page.route("https://tile.openstreetmap.org/**", (route: Route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: BLANK_PNG }),
  );
}

type Created = { id: string; version: number };

/** A fresh active template for this test, so starting a Pipeline never depends on another test's data. */
async function createTemplate(page: Page) {
  const response = await page.request.post("/api/pipeline-templates", {
    headers: { "idempotency-key": crypto.randomUUID() },
    data: {
      name: e2eName("Umum"),
      stages: [{ name: "Identifikasi", tasks: [{ name: "Kumpulkan data" }, { name: "Telepon kontak" }] }, { name: "Presentasi" }, { name: "Negosiasi" }],
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: string; name: string };
}

async function startPipeline(page: Page, prospectId: string, templateId: string) {
  const response = await page.request.post("/api/pipelines", {
    headers: { "idempotency-key": crypto.randomUUID() },
    data: { prospectId, templateId },
  });
  expect(response.status(), "start Pipeline").toBe(201);
  return (await response.json()) as Created;
}

async function setOutcome(page: Page, pipeline: Created, data: Record<string, unknown>) {
  const response = await page.request.post(`/api/pipelines/${pipeline.id}/outcome`, { data: { ...data, version: pipeline.version } });
  expect(response.status(), "set Outcome").toBe(200);
  return (await response.json()) as Created;
}

const wibToday = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);

async function createActivity(page: Page, input: { prospectId: string; fundingOfficerId: string; startsAt: string; purpose: string }) {
  const response = await page.request.post("/api/activities", {
    headers: { "idempotency-key": crypto.randomUUID() },
    data: input,
  });
  expect(response.status(), `create Kegiatan ${input.purpose}`).toBe(201);
  return (await response.json()) as Created;
}

const inDays = (days: number, hour = 2) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString();
};

const inHours = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();

/** Creates Activities through the API, 20 at a time, so 100+ of them stay quick. */
async function createManyActivities(page: Page, prospectId: string, fundingOfficerId: string, count: number, label: string) {
  for (let from = 0; from < count; from += 20) {
    await Promise.all(
      Array.from({ length: Math.min(20, count - from) }, (_, index) =>
        createActivity(page, { prospectId, fundingOfficerId, startsAt: inHours(from + index + 1), purpose: `${label} ${from + index + 1}` }),
      ),
    );
  }
}

/** The page's client-side navigation (no reload), as a link inside the app would do it. */
async function clientNavigate(page: Page, path: string) {
  await page.evaluate((target) => (window as unknown as { next: { router: { push: (href: string) => void } } }).next.router.push(target), path);
}

/** Leaflet is mounted and has placed its marker: the skeleton is gone. */
async function expectMapLoaded(page: Page) {
  const map = page.getByTestId("mini-map");
  await expect(map.locator(".leaflet-container")).toBeVisible();
  await expect(map.locator(".leaflet-marker-icon")).toBeVisible();
}

const heading1 = (page: Page) => page.getByRole("heading", { level: 1 });
/** The visible name heading: the top bar's (desktop) or the first section's (mobile, tablet). */
// On desktop the top bar reads "Prospect" while loading, so wait for the name itself.
const nameHeading = (page: Page, name: string) =>
  isDesktop(page) ? page.getByRole("heading", { level: 1, name, exact: true }) : page.getByRole("heading", { level: 2, name, exact: true });
const section = (page: Page, name: string) => page.getByRole("region", { name, exact: true });

async function open(page: Page, id: string, name: string) {
  await page.goto(`/prospect/${id}`);
  await expect(nameHeading(page, name)).toBeVisible();
}

/** Mobile and tablet keep Ubah and Arsipkan in the top bar's menu; desktop writes them out in the header. */
async function openActions(page: Page) {
  if (isDesktop(page)) return;
  await page.getByRole("button", { name: "Tindakan Prospect" }).click();
}

test.describe("E2-S4 Prospect detail", () => {
  let officer: FundingOfficerRecord;
  let templateId: string;

  test.beforeEach(async ({ page }) => {
    await stubTiles(page);
    await signInAsAdmin(page);
    officer = await createFundingOfficer(page, e2eName("Rina Kartika"));
    templateId = (await createTemplate(page)).id;
  });

  test("criterion 1: shows the data, the Kontak with tap-to-call, the open Pipeline, the closed one and the Kegiatan", async ({ page }) => {
    const name = e2eName("SDN 3 Cibinong");
    const prospect = await createProspect(page, {
      name,
      fundingOfficerId: officer.id,
      category: "sekolah",
      address: "Jl. Raya Bogor Km 43",
      location: { lat: -6.4817, lng: 106.854 },
      contact: { name: "Ibu Sri Wahyuni", role: "Kepala Sekolah", phone: "0812 3456 7890" },
      potentialAccounts: 1250,
      note: "Minta brosur tabungan pelajar.",
    });
    // A closed (Won) Pipeline, then the open one.
    const first = await startPipeline(page, prospect.id, templateId);
    await setOutcome(page, first, { outcome: "won", accountsOpened: 350, wonOn: wibToday() });
    await startPipeline(page, prospect.id, templateId);
    await createActivity(page, { prospectId: prospect.id, fundingOfficerId: officer.id, startsAt: inDays(3), purpose: "Presentasi tabungan pelajar" });
    const cancelled = await createActivity(page, { prospectId: prospect.id, fundingOfficerId: officer.id, startsAt: inDays(5), purpose: "Kunjungan ulang yang dibatalkan" });
    expect((await page.request.post(`/api/activities/${cancelled.id}/cancel`, { data: { version: cancelled.version } })).status()).toBe(200);

    await open(page, prospect.id, name);
    await expect(page).toHaveTitle(/Detail Prospect/);

    // Funding Officer and Kategori under the name.
    await expect(page.getByText(`Sekolah, ${officer.name}`)).toBeVisible();

    // The open Pipeline with its Stage, progress and the link to it.
    const running = section(page, "Pipeline berjalan");
    await expect(running.getByRole("img", { name: "Identifikasi, tahap 1 dari 3" })).toBeVisible();
    await expect(running.getByText("0/2 Tugas").first()).toBeVisible();
    await expect(running.getByRole("progressbar")).toBeVisible();
    await expect(running.getByRole("link", { name: "Buka Pipeline" })).toHaveAttribute("href", /^\/pipeline\/[0-9a-f-]{36}$/);
    // EC16: a Prospect with an open Pipeline cannot start another.
    await expect(page.getByRole("button", { name: "Mulai Pipeline" })).toHaveCount(0);

    // Kontak: name, role and a tap-to-call link with the dialled number as its name.
    const contact = section(page, "Kontak");
    await expect(contact.getByText("Ibu Sri Wahyuni, Kepala Sekolah")).toBeVisible();
    const call = contact.getByRole("link", { name: "Telepon Ibu Sri Wahyuni, 0812-3456-7890" });
    await expect(call).toHaveAttribute("href", "tel:+6281234567890");

    // Data Prospect.
    const data = section(page, "Data Prospect");
    await expect(data.getByText("Jl. Raya Bogor Km 43")).toBeVisible();
    await expect(data.getByText("1.250 rekening")).toBeVisible();
    await expect(data.getByText("Minta brosur tabungan pelajar.")).toBeVisible();
    await expect(data.getByText("-6.4817, 106.8540")).toBeVisible();
    await expect(data.getByTestId("mini-map").locator(".leaflet-container")).toBeVisible();

    // Upcoming Kegiatan (a tab on desktop, a section from mobile), then the past ones.
    if (isDesktop(page)) {
      await expect(page.getByRole("tab", { name: "Kegiatan mendatang" })).toHaveAttribute("aria-selected", "true");
      await expect(page.getByText("Presentasi tabungan pelajar")).toBeVisible();
      await expect(page.getByText("Kunjungan ulang yang dibatalkan")).toBeHidden();
      await page.getByRole("tab", { name: "Kegiatan lalu" }).click();
      await expect(page.getByText("Kunjungan ulang yang dibatalkan")).toBeVisible();
      await expect(page.getByText("Dibatalkan", { exact: true })).toBeVisible();
    } else {
      await expect(section(page, "Kegiatan mendatang").getByText("Presentasi tabungan pelajar")).toBeVisible();
      await expect(section(page, "Kegiatan mendatang").getByRole("link", { name: "Tambah Kegiatan" })).toBeVisible();
      const history = section(page, "Riwayat");
      await expect(history.getByText("Kunjungan ulang yang dibatalkan")).toBeVisible();
    }
    if (isDesktop(page)) await page.getByRole("tab", { name: "Kegiatan mendatang" }).click();
    const activityLink = page.getByRole("link", { name: /Presentasi tabungan pelajar/ }).first();
    await expect(activityLink).toHaveAttribute("href", /^\/kegiatan\/[0-9a-f-]{36}$/);

    // The closed Pipeline: Berhasil with the accounts opened.
    const closedScope = isDesktop(page) ? section(page, "Riwayat Pipeline") : section(page, "Riwayat");
    await expect(closedScope.getByText("Berhasil")).toBeVisible();
    await expect(closedScope.getByText("350 rekening dibuka")).toBeVisible();

    await expectNoHorizontalScroll(page);
    await expectMapLoaded(page);
    await page.screenshot({ path: `test-results/screens/E2-S4/${test.info().project.name}-normal.png`, fullPage: true });
  });

  test("criterion 1: Funding Officer nonaktif is shown next to the name (E1-S4)", async ({ page }) => {
    const name = e2eName("Pasar Kramat Jati Blok B");
    const prospect = await createProspect(page, { name, fundingOfficerId: officer.id, category: "pasar" });
    await deactivateFundingOfficer(page, officer);
    await open(page, prospect.id, name);
    await expect(page.getByText("Funding Officer nonaktif")).toBeVisible();
    // Without an open Pipeline the Prospect can still start one from the page; the server decides (422).
    await expect(page.getByText(COPY.noOpenPipeline)).toBeVisible();
  });

  test("criterion 1: no Pipeline, no Kegiatan and no Kontak say so, with the actions to start", async ({ page }) => {
    const name = e2eName("PT Sinar Logistik");
    const prospect = await createProspect(page, { name, fundingOfficerId: officer.id });
    await open(page, prospect.id, name);

    await expect(section(page, "Pipeline berjalan").getByText(COPY.noOpenPipeline)).toBeVisible();
    await expect(section(page, "Pipeline berjalan").getByRole("button", { name: "Mulai Pipeline" })).toBeVisible();
    await expect(page.getByText(COPY.noActivities)).toBeVisible();
    await expect(page.getByRole("link", { name: "Tambah Kegiatan" })).toBeVisible();
    await expect(section(page, "Kontak").getByText("Belum ada Kontak.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Telepon", exact: false })).toHaveCount(0);
    await page.screenshot({ path: `test-results/screens/E2-S4/${test.info().project.name}-empty.png`, fullPage: true });
  });

  test("criterion 2: Mulai Pipeline starts one from a template, then the button is gone (EC16)", async ({ page }) => {
    const name = e2eName("SMPN 1 Bogor");
    const prospect = await createProspect(page, { name, fundingOfficerId: officer.id });
    await open(page, prospect.id, name);

    await section(page, "Pipeline berjalan").getByRole("button", { name: "Mulai Pipeline" }).click();
    const dialog = page.getByRole("dialog", { name: "Mulai Pipeline" });
    await expect(dialog).toBeVisible();
    // The Mulai button waits for a template when several are active; pick this test's own.
    const select = dialog.getByLabel("Template");
    await expect(select).toBeVisible();
    await select.selectOption(templateId);
    await page.waitForTimeout(300); // the dialog's 150 ms fade, so the screenshot shows it settled
    await page.screenshot({ path: `test-results/screens/E2-S4/${test.info().project.name}-start-dialog.png` });

    const starts: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname === "/api/pipelines") starts.push(request.url());
    });
    const start = dialog.getByRole("button", { name: "Mulai", exact: true });
    await start.dblclick();
    await expect(dialog).toBeHidden();
    expect(starts.length, "a double tap starts one Pipeline").toBe(1);

    const running = section(page, "Pipeline berjalan");
    await expect(running.getByRole("img", { name: "Identifikasi, tahap 1 dari 3" })).toBeVisible();
    await expect(running.getByRole("link", { name: "Buka Pipeline" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Mulai Pipeline" })).toHaveCount(0);
    const list = await (await page.request.get(`/api/pipelines?prospectId=${prospect.id}`)).json();
    expect(list.items).toHaveLength(1);
  });

  test("criterion 2: no Mulai Pipeline with an On Hold Pipeline (EC16)", async ({ page }) => {
    const name = e2eName("Koperasi Warga Sejahtera");
    const prospect = await createProspect(page, { name, fundingOfficerId: officer.id });
    const pipeline = await startPipeline(page, prospect.id, templateId);
    await setOutcome(page, pipeline, { outcome: "on_hold" });
    await open(page, prospect.id, name);

    await expect(section(page, "Pipeline berjalan").getByText("Ditunda")).toBeVisible();
    await expect(page.getByRole("button", { name: "Mulai Pipeline" })).toHaveCount(0);
  });

  test("criterion 2: another tab started a Pipeline first, so the dialog shows the server's sentence (EC16)", async ({ page }) => {
    const name = e2eName("Pasar Anyar Blok A");
    const prospect = await createProspect(page, { name, fundingOfficerId: officer.id });
    await open(page, prospect.id, name);

    await startPipeline(page, prospect.id, templateId); // the other tab
    await section(page, "Pipeline berjalan").getByRole("button", { name: "Mulai Pipeline" }).click();
    const dialog = page.getByRole("dialog", { name: "Mulai Pipeline" });
    await dialog.getByLabel("Template").selectOption(templateId);
    await dialog.getByRole("button", { name: "Mulai", exact: true }).click();

    await expect(dialog.getByText("Prospect ini masih punya Pipeline yang berjalan.")).toBeVisible();
    await dialog.getByRole("button", { name: "Batal" }).click();
    // The page reloaded behind the dialog: the open Pipeline shows, with no Mulai Pipeline.
    await expect(section(page, "Pipeline berjalan").getByRole("link", { name: "Buka Pipeline" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Mulai Pipeline" })).toHaveCount(0);
  });

  test("criterion 3: with an open Pipeline Arsipkan is not offered, and the reason is given (EC19)", async ({ page }) => {
    const name = e2eName("SDN 5 Depok");
    const prospect = await createProspect(page, { name, fundingOfficerId: officer.id });
    await startPipeline(page, prospect.id, templateId);
    await open(page, prospect.id, name);

    await openActions(page);
    if (isDesktop(page)) {
      const archive = page.getByRole("button", { name: "Arsipkan" });
      await expect(archive).toHaveAttribute("aria-disabled", "true");
      await expect(archive).toHaveAccessibleDescription(COPY.blocked);
      await expect(page.getByText(COPY.blocked)).toBeVisible();
      await archive.click({ force: true });
    } else {
      const item = page.getByRole("menuitem", { name: /Arsipkan/ });
      await expect(item).toHaveAttribute("aria-disabled", "true");
      await expect(item).toHaveAccessibleDescription(COPY.blocked);
      await expect(page.getByRole("menu").getByText(COPY.blocked)).toBeVisible();
      await page.screenshot({ path: `test-results/screens/E2-S4/${test.info().project.name}-archive-blocked.png` });
      await item.click({ force: true });
    }
    // Nothing opened and nothing changed.
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const record = await (await page.request.get(`/api/prospects/${prospect.id}`)).json();
    expect(record.archived).toBe(false);
  });

  test("criterion 4: archiving asks first and says how many future Kegiatan are cancelled (EC19)", async ({ page }) => {
    const name = e2eName("SD Islam Al-Azhar Cibinong");
    const prospect = await createProspect(page, { name, fundingOfficerId: officer.id });
    for (const days of [2, 4]) {
      await createActivity(page, { prospectId: prospect.id, fundingOfficerId: officer.id, startsAt: inDays(days), purpose: `Kunjungan hari ke-${days}` });
    }
    // An On Hold Pipeline does not block archiving.
    const pipeline = await startPipeline(page, prospect.id, templateId);
    await setOutcome(page, pipeline, { outcome: "on_hold" });
    await open(page, prospect.id, name);

    await openActions(page);
    await (isDesktop(page) ? page.getByRole("button", { name: "Arsipkan" }) : page.getByRole("menuitem", { name: "Arsipkan" })).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: `Arsipkan ${name}?` })).toBeVisible();
    await expect(dialog.getByText("2 Kegiatan mendatang akan dibatalkan.")).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `test-results/screens/E2-S4/${test.info().project.name}-archive-confirm.png` });
    // Nothing happened yet.
    expect((await (await page.request.get(`/api/prospects/${prospect.id}`)).json()).archived).toBe(false);

    await dialog.getByRole("button", { name: "Batal" }).click();
    await expect(dialog).toBeHidden();
    expect((await (await page.request.get(`/api/prospects/${prospect.id}`)).json()).archived).toBe(false);

    await openActions(page);
    await (isDesktop(page) ? page.getByRole("button", { name: "Arsipkan" }) : page.getByRole("menuitem", { name: "Arsipkan" })).click();
    await expect(page.getByRole("dialog").getByText("2 Kegiatan mendatang akan dibatalkan.")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Arsipkan", exact: true }).click();

    // The page is now read-only, with the archived label.
    await expect(page.getByText(/^Prospect ini diarsipkan pada \d{1,2} \w{3} \d{4}\.$/)).toBeVisible();
    const archived = await (await page.request.get(`/api/prospects/${prospect.id}`)).json();
    expect(archived.archived).toBe(true);
    const activities = await (await page.request.get(`/api/activities?prospectId=${prospect.id}`)).json();
    expect(activities.items.map((item: { status: string }) => item.status)).toEqual(["cancelled", "cancelled"]);
  });

  test("criterion 4: no sentence about cancelled Kegiatan when there are none", async ({ page }) => {
    const name = e2eName("Pasar Minggu Blok C");
    const prospect = await createProspect(page, { name, fundingOfficerId: officer.id });
    await open(page, prospect.id, name);

    await openActions(page);
    await (isDesktop(page) ? page.getByRole("button", { name: "Arsipkan" }) : page.getByRole("menuitem", { name: "Arsipkan" })).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: `Arsipkan ${name}?` })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Arsipkan", exact: true })).toBeEnabled();
    await expect(dialog.getByText(/Kegiatan mendatang akan dibatalkan/)).toHaveCount(0);
  });

  test("criterion 4: a failed archive keeps the dialog open, shows why, and a 409 offers Muat ulang (EC18)", async ({ page }) => {
    const name = e2eName("SMK Negeri 2 Bogor");
    const prospect = await createProspect(page, { name, fundingOfficerId: officer.id });
    await open(page, prospect.id, name);

    await openActions(page);
    await (isDesktop(page) ? page.getByRole("button", { name: "Arsipkan" }) : page.getByRole("menuitem", { name: "Arsipkan" })).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Arsipkan", exact: true })).toBeEnabled();

    let status = 0;
    await page.route(
      (url) => url.pathname === `/api/prospects/${prospect.id}/archive`,
      (route) =>
        status === 0
          ? route.abort("failed")
          : route.fulfill({
              status: 409,
              contentType: "application/json",
              body: JSON.stringify({ error: { code: "version_conflict", message: "Data ini sudah diubah. Muat ulang untuk melihat versi terbaru." } }),
            }),
    );
    await dialog.getByRole("button", { name: "Arsipkan", exact: true }).click();
    await expect(dialog.getByText("Gagal menyimpan. Periksa koneksi lalu coba lagi.")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Arsipkan", exact: true })).toBeEnabled();

    status = 409;
    await dialog.getByRole("button", { name: "Arsipkan", exact: true }).click();
    await expect(dialog.getByText("Data ini sudah diubah. Muat ulang untuk melihat versi terbaru.")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Muat ulang" })).toBeVisible();
  });

  test("criterion 5: an archived Prospect opens read-only with Diarsipkan and Pulihkan; restoring brings the actions back (EC40)", async ({ page }) => {
    const name = e2eName("Perumahan Griya Asri");
    const prospect = await createProspect(page, { name, fundingOfficerId: officer.id, category: "komunitas" });
    await archiveProspect(page, prospect);
    await open(page, prospect.id, name);

    await expect(page.getByText(/^Prospect ini diarsipkan pada \d{1,2} \w{3} \d{4}\.$/)).toBeVisible();
    await expect(page.getByText("Diarsipkan", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Pulihkan" })).toBeVisible();
    // Read-only: no Ubah, Arsipkan, Mulai Pipeline, Tambah Kegiatan or menu.
    for (const hidden of ["Ubah", "Arsipkan", "Mulai Pipeline", "Tambah Kegiatan", "Tindakan Prospect"]) {
      await expect(page.getByRole("button", { name: hidden, exact: true })).toHaveCount(0);
      await expect(page.getByRole("link", { name: hidden, exact: true })).toHaveCount(0);
    }
    await page.screenshot({ path: `test-results/screens/E2-S4/${test.info().project.name}-archived.png`, fullPage: true });
    await expectNoHorizontalScroll(page);

    await page.getByRole("button", { name: "Pulihkan" }).click();
    await expect(page.getByRole("button", { name: "Pulihkan" })).toHaveCount(0);
    await expect(section(page, "Pipeline berjalan").getByRole("button", { name: "Mulai Pipeline" })).toBeVisible();
    await openActions(page);
    await expect(isDesktop(page) ? page.getByRole("link", { name: "Ubah", exact: true }) : page.getByRole("menuitem", { name: "Ubah" })).toBeVisible();
    expect((await (await page.request.get(`/api/prospects/${prospect.id}`)).json()).archived).toBe(false);
  });

  test("criterion 5: a missing ID shows the not-found page with a link back to the list (EC40)", async ({ page }) => {
    await page.goto("/prospect/00000000-0000-4000-8000-000000000000");
    await expect(page.getByText(COPY.notFound)).toBeVisible();
    const back = page.getByRole("link", { name: "Kembali ke daftar Prospect" });
    await expect(back).toBeVisible();
    await page.screenshot({ path: `test-results/screens/E2-S4/${test.info().project.name}-not-found.png` });
    await back.click();
    await expect(page).toHaveURL(/\/prospect$/);

    // An id that is not a UUID is also "not found", not an error.
    await page.goto("/prospect/bukan-id");
    await expect(page.getByText(COPY.notFound)).toBeVisible();
  });

  test("a failed load shows what happened with Coba lagi (state: error)", async ({ page }) => {
    test.setTimeout(120_000); // 103 Kegiatan are created through the API first
    const name = e2eName("Pasar Induk Kramat Jati");
    const prospect = await createProspect(page, { name, fundingOfficerId: officer.id });
    let fail = true;
    await page.route(
      (url) => url.pathname === `/api/prospects/${prospect.id}`,
      (route) => (fail ? route.abort("failed") : route.continue()),
    );
    await page.goto(`/prospect/${prospect.id}`);
    await expect(page.getByText(COPY.loadError)).toBeVisible();
    await page.screenshot({ path: `test-results/screens/E2-S4/${test.info().project.name}-error.png` });
    fail = false;
    await page.getByRole("button", { name: "Coba lagi" }).click();
    await expect(nameHeading(page, name)).toBeVisible();
  });

  test("a slow load shows section skeletons, not a spinner (state: loading)", async ({ page }) => {
    const name = e2eName("SDN 7 Tangerang");
    const prospect = await createProspect(page, { name, fundingOfficerId: officer.id });
    await page.route(
      (url) => url.pathname === `/api/prospects/${prospect.id}`,
      async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        await route.continue();
      },
    );
    await page.goto(`/prospect/${prospect.id}`);
    await expect(page.getByText("Memuat Prospect…")).toBeAttached();
    await expect(page.locator("[aria-busy] [data-slot=skeleton]:visible").first()).toBeVisible();
    await page.screenshot({ path: `test-results/screens/E2-S4/${test.info().project.name}-loading.png` });
    await expect(nameHeading(page, name)).toBeVisible();
  });

  test("EC34: a Prospect with no location says so, and Tambah lokasi opens the form at Lokasi", async ({ page }) => {
    const name = e2eName("Kantor Kecamatan Tanah Sareal");
    const prospect = await createProspect(page, { name, fundingOfficerId: officer.id });
    await open(page, prospect.id, name);

    const data = section(page, "Data Prospect");
    await expect(data.getByText("Belum ada lokasi")).toBeVisible();
    await expect(data.getByTestId("mini-map")).toHaveCount(0);
    await data.getByRole("link", { name: "Tambah lokasi" }).click();
    await expect(page).toHaveURL(new RegExp(`/prospect/${prospect.id}/ubah#lokasi$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ubah Prospect");
    await expect(page.getByRole("heading", { level: 2, name: "Lokasi" })).toBeInViewport();
  });

  test("Ubah opens the edit form; the back control returns to the list", async ({ page }) => {
    const name = e2eName("SDN 3 Cibinong");
    const prospect = await createProspect(page, { name, fundingOfficerId: officer.id });
    await open(page, prospect.id, name);

    await openActions(page);
    await (isDesktop(page) ? page.getByRole("link", { name: "Ubah", exact: true }) : page.getByRole("menuitem", { name: "Ubah" })).click();
    await expect(page).toHaveURL(`/prospect/${prospect.id}/ubah`);
    await page.goBack();
    await page.getByRole("link", { name: "Kembali" }).first().click();
    await expect(page).toHaveURL(/\/prospect$/);
  });

  test("EC7: the longest name wraps and the longest Kontak, address and note do not break the layout", async ({ page }) => {
    const name = e2eLongName();
    const prospect = await createProspect(page, {
      name,
      fundingOfficerId: officer.id,
      category: "komunitas",
      address: "Jl. Raya Pasar Anyar Nomor 123 RT 004 RW 009 Kelurahan Kebon Kalapa Kecamatan Bogor Tengah Kota Bogor Jawa Barat".repeat(2),
      contact: { name: "Bapak Haji Muhammad Abdurrahman Wahid Prakoso", role: "Ketua Paguyuban Pedagang Pasar Anyar", phone: "0812 3456 7890" },
      location: { lat: -6.5944, lng: 106.7892 },
      note: "Pertemuan terakhir membahas rencana pembukaan rekening untuk seluruh anggota paguyuban pada bulan depan. ".repeat(4).slice(0, 500),
    });
    const pipeline = await startPipeline(page, prospect.id, templateId);
    expect(pipeline.id).toBeTruthy();
    await createActivity(page, { prospectId: prospect.id, fundingOfficerId: officer.id, startsAt: inDays(1), purpose: "Presentasi program tabungan untuk seluruh anggota paguyuban pedagang pasar".repeat(2) });
    await open(page, prospect.id, name);

    await expectNoHorizontalScroll(page);
    await expect(heading1(page)).toBeVisible();
    await expectMapLoaded(page);
    await page.screenshot({ path: `test-results/screens/E2-S4/${test.info().project.name}-long.png`, fullPage: true });
  });

  test("BUG-5 #1: more than 100 Kegiatan: an old Overdue one is first, and Muat lebih banyak reaches the rest", async ({ page }) => {
    const name = e2eName("Pasar Induk Kramat Jati");
    const prospect = await createProspect(page, { name, fundingOfficerId: officer.id });
    // The oldest Activity is Scheduled and Overdue, older than 101 newer Scheduled ones.
    await createActivity(page, { prospectId: prospect.id, fundingOfficerId: officer.id, startsAt: inDays(-30), purpose: "Kunjungan lama yang terlewat" });
    await createManyActivities(page, prospect.id, officer.id, 101, "Kunjungan");
    const cancelled = await createActivity(page, { prospectId: prospect.id, fundingOfficerId: officer.id, startsAt: inDays(-2), purpose: "Kunjungan yang dibatalkan" });
    expect((await page.request.post(`/api/activities/${cancelled.id}/cancel`, { data: { version: cancelled.version } })).status()).toBe(200);
    await open(page, prospect.id, name);

    const upcoming = isDesktop(page) ? page.getByRole("tabpanel") : section(page, "Kegiatan mendatang");
    const rows = upcoming.locator("li");
    await expect(rows).toHaveCount(100);
    await expect(rows.first()).toContainText("Kunjungan lama yang terlewat");
    await expect(rows.first()).toContainText("Terlambat");
    // Finished work is a separate list, so it never takes a place in this one.
    await expect(upcoming.getByText("Kunjungan yang dibatalkan")).toHaveCount(0);

    const more = upcoming.getByRole("button", { name: "Muat lebih banyak" });
    if (!isDesktop(page)) await expectTouchTarget(more);
    await more.click();
    await expect(rows).toHaveCount(102);
    await expect(upcoming.getByRole("button", { name: "Muat lebih banyak" })).toHaveCount(0);
    await expect(upcoming.getByText("Kunjungan 101", { exact: true })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("BUG-5 #1: the history list pages too, and a failed page says so and can be retried", async ({ page }) => {
    const name = e2eName("Koperasi Warga Sejahtera");
    const prospect = await createProspect(page, { name, fundingOfficerId: officer.id });
    const made = await createActivity(page, { prospectId: prospect.id, fundingOfficerId: officer.id, startsAt: inDays(-3), purpose: "Kunjungan terbaru yang dibatalkan" });
    expect((await page.request.post(`/api/activities/${made.id}/cancel`, { data: { version: made.version } })).status()).toBe(200);

    // The server answers one finished row. Page 1 says there is more; page 2 fails once, then works.
    let page2Calls = 0;
    await page.route(
      (url) => url.pathname === "/api/activities" && url.searchParams.get("view") === "history",
      async (route) => {
        const url = new URL(route.request().url());
        const cursor = url.searchParams.get("cursor");
        if (!cursor) {
          const body = await (await route.fetch()).json();
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...body, hasMore: true }) });
        }
        page2Calls += 1;
        if (page2Calls === 1) return route.abort("failed");
        const first = (await (await route.fetch({ url: route.request().url().replace(/&cursor=[^&]+/, "") })).json()).items[0];
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ items: [{ ...first, id: "00000000-0000-4000-8000-0000000000a2", purpose: "Kunjungan lama dari halaman kedua" }], hasMore: false }),
        });
      },
    );
    await open(page, prospect.id, name);
    if (isDesktop(page)) await page.getByRole("tab", { name: "Kegiatan lalu" }).click();
    const history = isDesktop(page) ? page.getByRole("tabpanel") : section(page, "Riwayat");
    await expect(history.getByText("Kunjungan terbaru yang dibatalkan")).toBeVisible();

    await history.getByRole("button", { name: "Muat lebih banyak" }).click();
    await expect(history.getByText("Kegiatan berikutnya gagal dimuat. Periksa koneksi, lalu coba lagi.")).toBeVisible();
    await history.getByRole("button", { name: "Muat lebih banyak" }).click();
    await expect(history.getByText("Kunjungan lama dari halaman kedua")).toBeVisible();
    await expect(history.getByText("Kegiatan berikutnya gagal dimuat. Periksa koneksi, lalu coba lagi.")).toHaveCount(0);
    await expect(history.getByRole("button", { name: "Muat lebih banyak" })).toHaveCount(0);
  });

  test("BUG-5 #1: a next page that answers after the page reloaded is ignored, and the next request uses the new cursor", async ({ page }) => {
    const name = e2eName("Paguyuban Pedagang Pasar Baru");
    const prospect = await createProspect(page, { name, fundingOfficerId: officer.id });
    const made = await createActivity(page, { prospectId: prospect.id, fundingOfficerId: officer.id, startsAt: inDays(-3), purpose: "Kunjungan terbaru yang dibatalkan" });
    expect((await page.request.post(`/api/activities/${made.id}/cancel`, { data: { version: made.version } })).status()).toBe(200);

    // Page 1 says there is more. The first next-page request is held until the page reloaded, then answers stale data.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const cursors: (string | null)[] = [];
    await page.route(
      (url) => url.pathname === "/api/activities" && url.searchParams.get("view") === "history",
      async (route) => {
        const url = new URL(route.request().url());
        const cursor = url.searchParams.get("cursor");
        const body = await (await route.fetch({ url: route.request().url().replace(/&cursor=[^&]+/, "") })).json();
        if (!cursor) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...body, hasMore: true }) });
        cursors.push(cursor);
        const purpose = cursors.length === 1 ? "Kegiatan basi dari muatan lama" : "Kunjungan lama dari halaman kedua";
        if (cursors.length === 1) await held;
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ items: [{ ...body.items[0], id: `00000000-0000-4000-8000-00000000000${cursors.length}`, purpose }], hasMore: false }),
        });
      },
    );
    await open(page, prospect.id, name);
    if (isDesktop(page)) await page.getByRole("tab", { name: "Kegiatan lalu" }).click();
    const history = () => (isDesktop(page) ? page.getByRole("tabpanel") : section(page, "Riwayat"));
    await expect(history().getByText("Kunjungan terbaru yang dibatalkan")).toBeVisible();
    await history().getByRole("button", { name: "Muat lebih banyak" }).click();
    await expect.poll(() => cursors.length).toBe(1);

    // Starting a Pipeline reloads the page while the next page is still on its way.
    await section(page, "Pipeline berjalan").getByRole("button", { name: "Mulai Pipeline" }).click();
    const dialog = page.getByRole("dialog", { name: "Mulai Pipeline" });
    await dialog.getByLabel("Template").selectOption(templateId);
    await dialog.getByRole("button", { name: "Mulai", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(section(page, "Pipeline berjalan").getByRole("link", { name: "Buka Pipeline" })).toBeVisible();
    release();

    if (isDesktop(page)) await page.getByRole("tab", { name: "Kegiatan lalu" }).click();
    await expect(history().getByText("Kunjungan terbaru yang dibatalkan")).toBeVisible();
    await page.waitForTimeout(300); // give the stale answer time to arrive
    await expect(page.getByText("Kegiatan basi dari muatan lama")).toHaveCount(0);

    await history().getByRole("button", { name: "Muat lebih banyak" }).click();
    await expect(history().getByText("Kunjungan lama dari halaman kedua")).toBeVisible();
    expect(cursors).toEqual([made.id, made.id]);
    await expect(page.getByText("Kegiatan basi dari muatan lama")).toHaveCount(0);
  });

  test("BUG-5 #2: moving to another Prospect shows a clean loading state, not the last Prospect's data", async ({ page }) => {
    const nameA = e2eName("SDN 3 Cibinong");
    const nameB = e2eName("SMPN 1 Bogor");
    const a = await createProspect(page, { name: nameA, fundingOfficerId: officer.id });
    const b = await createProspect(page, { name: nameB, fundingOfficerId: officer.id });
    await open(page, a.id, nameA);

    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(
      (url) => url.pathname === `/api/prospects/${b.id}`,
      async (route) => {
        await held;
        await route.continue();
      },
    );
    await clientNavigate(page, `/prospect/${b.id}`);
    await expect(page).toHaveURL(new RegExp(`/prospect/${b.id}$`));
    // While B loads: the loading skeleton, nothing of A on screen, and no control that could act on A. Next keeps
    // the previous route's DOM hidden for a quick back navigation, and its route announcer (a 1 px live region)
    // reads out the page title, so only what is visible inside the page content counts.
    await expect(page.getByText("Memuat Prospect…")).toBeAttached();
    await expect(page.locator("[aria-busy] [data-slot=skeleton]:visible").first()).toBeVisible();
    await expect(page.locator("main, header").getByText(nameA).filter({ visible: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Tindakan Prospect" }).filter({ visible: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Arsipkan", exact: true }).filter({ visible: true })).toHaveCount(0);
    release();
    await expect(nameHeading(page, nameB).filter({ visible: true })).toBeVisible();
    await expect(page.locator("main, header").getByText(nameA).filter({ visible: true })).toHaveCount(0);
  });

  test("BUG-5 #3: after an archive conflict the count is read again, and Arsipkan waits for it (EC18)", async ({ page }) => {
    const name = e2eName("SD Islam Al-Azhar Cibinong");
    const prospect = await createProspect(page, { name, fundingOfficerId: officer.id });
    await open(page, prospect.id, name);

    await openActions(page);
    await (isDesktop(page) ? page.getByRole("button", { name: "Arsipkan" }) : page.getByRole("menuitem", { name: "Arsipkan" })).click();
    const dialog = page.getByRole("dialog");
    const archive = dialog.getByRole("button", { name: "Arsipkan", exact: true });
    await expect(archive).toBeEnabled();
    await expect(dialog.getByText(/Kegiatan mendatang akan dibatalkan/)).toHaveCount(0);

    // Another tab changes the Prospect (version + 1) and plans a future Kegiatan.
    expect((await page.request.patch(`/api/prospects/${prospect.id}`, { data: { note: "Diubah di tab lain", version: prospect.version } })).status()).toBe(200);
    await createActivity(page, { prospectId: prospect.id, fundingOfficerId: officer.id, startsAt: inDays(2), purpose: "Kunjungan dari tab lain" });

    await archive.click();
    await expect(dialog.getByText("Data ini sudah diubah. Muat ulang untuk melihat versi terbaru.")).toBeVisible();

    // The second preview request is slow, so the wait is visible.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(
      (url) => url.pathname === `/api/prospects/${prospect.id}/archive-preview`,
      async (route) => {
        await held;
        await route.continue();
      },
    );
    await dialog.getByRole("button", { name: "Muat ulang" }).click();
    await expect(dialog.getByText("Memuat Prospect…")).toBeAttached();
    await expect(dialog.getByRole("button", { name: "Arsipkan", exact: true })).toBeDisabled();
    release();
    await expect(dialog.getByText("1 Kegiatan mendatang akan dibatalkan.")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Arsipkan", exact: true })).toBeEnabled();
    // The old, conflicting message is gone, and archiving now works with the new version.
    await expect(dialog.getByText("Data ini sudah diubah.")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Arsipkan", exact: true }).click();
    await expect(page.getByText(/^Prospect ini diarsipkan pada /)).toBeVisible();
    const activities = await (await page.request.get(`/api/activities?prospectId=${prospect.id}&view=history`)).json();
    expect(activities.items.map((item: { status: string }) => item.status)).toEqual(["cancelled"]);
  });

  test("BUG-5 #4: after the location changed elsewhere, a reload puts the marker at the new location", async ({ page }) => {
    const name = e2eName("Pasar Kramat Jati Blok B");
    const prospect = await createProspect(page, { name, fundingOfficerId: officer.id, location: { lat: -6.4817, lng: 106.854 } });
    await open(page, prospect.id, name);
    await expectMapLoaded(page);
    await expect(page.getByText("-6.4817, 106.8540")).toBeVisible();

    // Another tab moves the Prospect across Java, and starts its Pipeline.
    const moved = await page.request.patch(`/api/prospects/${prospect.id}`, { data: { location: { lat: -7.2575, lng: 112.7521 }, version: prospect.version } });
    expect(moved.status()).toBe(200);
    await startPipeline(page, prospect.id, templateId);

    // "Mulai Pipeline" meets the open Pipeline (409), and the page reloads its data behind the dialog.
    await section(page, "Pipeline berjalan").getByRole("button", { name: "Mulai Pipeline" }).click();
    const dialog = page.getByRole("dialog", { name: "Mulai Pipeline" });
    await dialog.getByLabel("Template").selectOption(templateId);
    await dialog.getByRole("button", { name: "Mulai", exact: true }).click();
    await expect(dialog.getByText("Prospect ini masih punya Pipeline yang berjalan.")).toBeVisible();
    await dialog.getByRole("button", { name: "Batal" }).click();

    await expect(page.getByText("-7.2575, 112.7521")).toBeVisible();
    await expectMapLoaded(page);
    const map = page.getByTestId("mini-map");
    const frame = (await map.boundingBox())!;
    const marker = (await map.locator(".leaflet-marker-icon").boundingBox())!;
    // The marker sits inside the map frame (with the old centre it would be hundreds of kilometres away).
    expect(marker.x).toBeGreaterThanOrEqual(frame.x);
    expect(marker.x + marker.width).toBeLessThanOrEqual(frame.x + frame.width);
    expect(marker.y).toBeGreaterThanOrEqual(frame.y);
    expect(marker.y + marker.height).toBeLessThanOrEqual(frame.y + frame.height);
  });

  test("BUG-5 #5: the map has a label, and the OpenStreetMap credit is a reachable link with a 44 px target", async ({ page }) => {
    const name = e2eName("SDN 3 Cibinong");
    const prospect = await createProspect(page, { name, fundingOfficerId: officer.id, location: { lat: -6.4817, lng: 106.854 } });
    await open(page, prospect.id, name);
    await expectMapLoaded(page);

    const map = page.getByRole("img", { name: "Peta lokasi Prospect" });
    await expect(map).toBeVisible();
    // The map is not inert: it is not hidden from assistive technology.
    await expect(map).not.toHaveAttribute("inert", /.*/);

    const credit = page.getByRole("link", { name: /OpenStreetMap/ });
    await expect(credit).toBeVisible();
    await expect(credit).toHaveAccessibleName("© OpenStreetMap. Lihat peta di OpenStreetMap");
    await expect(credit).toHaveAttribute("href", "https://www.openstreetmap.org/copyright");
    await expect(credit).toHaveAttribute("rel", /noopener/);
    // A link inside role="img" would be unreachable: the credit sits beside the map, not in it.
    await expect(map.getByRole("link")).toHaveCount(0);
    // Leaflet's own 11 px credit control is not used.
    await expect(page.locator(".leaflet-control-attribution")).toHaveCount(0);

    await credit.focus();
    await expect(credit).toBeFocused();
    if (!isDesktop(page)) await expectTouchTarget(credit, 44);
    // The map itself does not pan or zoom with a drag or the keyboard.
    const before = await map.locator(".leaflet-marker-icon").boundingBox();
    const box = (await map.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 4 });
    await page.mouse.up();
    const after = await map.locator(".leaflet-marker-icon").boundingBox();
    expect(after).toEqual(before);
  });

  test("responsive: touch targets are at least 44 px on mobile and tablet; no horizontal scroll", async ({ page }) => {
    const name = e2eName("SDN 3 Cibinong");
    const prospect = await createProspect(page, {
      name,
      fundingOfficerId: officer.id,
      contact: { name: "Ibu Sri Wahyuni", role: "Kepala Sekolah", phone: "0812 3456 7890" },
    });
    await open(page, prospect.id, name);
    await expectNoHorizontalScroll(page);
    if (isDesktop(page)) return;

    await expectTouchTarget(section(page, "Pipeline berjalan").getByRole("button", { name: "Mulai Pipeline" }));
    await expectTouchTarget(page.getByRole("link", { name: /^Telepon / }));
    await expectTouchTarget(page.getByRole("link", { name: "Tambah Kegiatan" }));
    await expectTouchTarget(page.getByRole("button", { name: "Tindakan Prospect" }));
  });

  test("responsive: the start dialog is a bottom sheet on mobile, centred from 768 px", async ({ page }) => {
    const name = e2eName("SDN 3 Cibinong");
    const prospect = await createProspect(page, { name, fundingOfficerId: officer.id });
    await open(page, prospect.id, name);
    await section(page, "Pipeline berjalan").getByRole("button", { name: "Mulai Pipeline" }).click();
    const dialog = page.getByRole("dialog", { name: "Mulai Pipeline" });
    await expect(dialog).toBeVisible();
    const box = (await dialog.boundingBox())!;
    const viewport = page.viewportSize()!;
    if (viewport.width < 768) {
      expect(box.x).toBeLessThanOrEqual(1);
      expect(box.y + box.height).toBeGreaterThanOrEqual(viewport.height - 1);
    } else {
      expect(box.y + box.height).toBeLessThan(viewport.height);
      expect(box.x).toBeGreaterThan(0);
    }
  });
});
