import { expect, test, type Page, type Request, type Route } from "@playwright/test";
import { signInAsAdmin } from "./support/admin";
import { createFundingOfficer, deactivateFundingOfficer, e2eName, type FundingOfficerRecord } from "./support/funding-officers";
import { createProspect } from "./support/prospects";
import { expectNoHorizontalScroll, expectTouchTarget } from "./support/responsive";

// E2-S3: the Prospect form (add and edit) with its location picker. Signed in as the e2e Admin against the
// dev server's database.
//
// Parallel-safe: every test adds its own Funding Officer and Prospects with e2e-marked names, and picks its
// own Funding Officer in the form (other tests' Funding Officers are active at the same time). Map tiles are
// answered with a blank image, so the tests never load OpenStreetMap. GPS uses Playwright's geolocation, or
// an init script that answers getCurrentPosition with an error (denied, timeout) or never answers.

const NEW_PATH = "/prospect/baru";
const COPY = {
  nameRequired: "Nama Prospect wajib diisi.",
  noActiveOfficers: "Tambahkan Funding Officer dulu. Setiap Prospect perlu ditugaskan ke satu Funding Officer.",
  gpsDenied: "Izin lokasi ditolak. Ketuk peta untuk menandai lokasi.",
  gpsFailed: "Lokasi belum didapat. Ketuk peta untuk menandai lokasi.",
  noteHint: "Jangan tulis nama, NIK, atau nomor rekening nasabah.",
  saveFailed: "Gagal menyimpan. Periksa koneksi lalu coba lagi.",
  conflict: "Data ini sudah diubah. Muat ulang untuk melihat versi terbaru.",
  outside: "Lokasi di luar Indonesia.",
  saved: "Prospect disimpan.",
};

const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1024;

const field = {
  name: (page: Page) => page.getByRole("textbox", { name: "Nama Prospect", exact: true }),
  officer: (page: Page) => page.getByRole("combobox", { name: "Funding Officer", exact: true }),
  category: (page: Page) => page.getByRole("combobox", { name: "Kategori", exact: true }),
  address: (page: Page) => page.getByRole("textbox", { name: "Alamat", exact: true }),
  contactName: (page: Page) => page.getByRole("textbox", { name: "Nama", exact: true }),
  contactRole: (page: Page) => page.getByRole("textbox", { name: "Jabatan", exact: true }),
  contactPhone: (page: Page) => page.getByRole("textbox", { name: "Telepon", exact: true }),
  potential: (page: Page) => page.getByRole("textbox", { name: "Potensi rekening", exact: true }),
  note: (page: Page) => page.getByRole("textbox", { name: "Catatan", exact: true }),
  lat: (page: Page) => page.getByRole("textbox", { name: "Lintang", exact: true }),
  lng: (page: Page) => page.getByRole("textbox", { name: "Bujur", exact: true }),
};
const saveButton = (page: Page) => page.getByRole("button", { name: /^(Simpan|Menyimpan…)$/ });
const gpsButton = (page: Page) => page.getByRole("button", { name: /^(Gunakan lokasi saya|Mencari lokasi…)$/ });
const map = (page: Page) => page.getByTestId("location-map");
/** Taps the map once Leaflet has loaded (the map module loads on the client after the form). */
async function tapMap(page: Page, fraction = 0.5) {
  await expect(map(page).locator(".leaflet-container")).toBeVisible();
  const box = (await map(page).boundingBox())!;
  await map(page).click({ position: { x: box.width * fraction, y: box.height * fraction } });
}
const locationLine = (page: Page) => page.getByTestId("location-line");
/** The message under a field: the element its input names in aria-describedby. */
const errorOf = (page: Page, input: ReturnType<typeof field.name>) =>
  input.evaluate((element) => {
    const ids = (element.getAttribute("aria-describedby") ?? "").split(" ").filter((id) => id.endsWith("-error"));
    return ids.map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
  });

const isCreate = (request: Request) => request.method() === "POST" && new URL(request.url()).pathname === "/api/prospects";

/** A blank 1×1 PNG for every map tile. */
const BLANK_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

async function openNewForm(page: Page) {
  await page.goto(NEW_PATH);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tambah Prospect");
  await expect(field.name(page)).toBeVisible();
}

/** Counts POST /api/prospects requests the page sends. */
function countCreates(page: Page) {
  const counter = { count: 0 };
  page.on("request", (request) => {
    if (isCreate(request)) counter.count += 1;
  });
  return counter;
}

async function getProspect(page: Page, id: string) {
  const response = await page.request.get(`/api/prospects/${id}`);
  expect(response.status()).toBe(200);
  return response.json();
}

/** Replaces navigator.geolocation.getCurrentPosition before the page loads. */
async function stubGeolocation(page: Page, behaviour: "denied" | "timeout" | "never") {
  await page.addInitScript((mode) => {
    const geolocation = navigator.geolocation;
    geolocation.getCurrentPosition = (_success, error) => {
      if (mode === "never" || !error) return;
      const code = mode === "denied" ? 1 : 3;
      setTimeout(() =>
        error({ code, message: mode, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError),
      );
    };
  }, behaviour);
}

test.describe("E2-S3 Prospect form", () => {
  let officer: FundingOfficerRecord;

  test.beforeEach(async ({ page }) => {
    await page.route("https://tile.openstreetmap.org/**", (route: Route) =>
      route.fulfill({ status: 200, contentType: "image/png", body: BLANK_PNG }),
    );
    await signInAsAdmin(page);
    officer = await createFundingOfficer(page, e2eName("Rina Kartika"));
  });

  test("criterion 1, EC9: saving without a name shows the message under Nama, focuses it, and sends nothing", async ({ page }) => {
    const creates = countCreates(page);
    await openNewForm(page);
    await field.officer(page).selectOption(officer.id);
    await saveButton(page).click();

    await expect(page.getByText(COPY.nameRequired)).toBeVisible();
    await expect(field.name(page)).toHaveAttribute("aria-invalid", "true");
    expect(await errorOf(page, field.name(page))).toBe(COPY.nameRequired);
    await expect(field.name(page)).toBeFocused();
    expect(creates.count).toBe(0);
    await expect(page).toHaveURL(NEW_PATH);

    // Typing clears the message.
    await field.name(page).fill("SDN 3 Cibinong");
    await expect(page.getByText(COPY.nameRequired)).toHaveCount(0);
  });

  test("criterion 1: a server rule shows under its field (inactive Funding Officer under Funding Officer)", async ({ page }) => {
    await openNewForm(page);
    await field.name(page).fill(e2eName("SDN 3 Cibinong"));
    await field.officer(page).selectOption(officer.id);
    // The Funding Officer is deactivated after the form loaded: only the server knows.
    await deactivateFundingOfficer(page, officer);
    await saveButton(page).click();

    await expect(page.getByText("Funding Officer ini sudah nonaktif.")).toBeVisible();
    expect(await errorOf(page, field.officer(page))).toBe("Funding Officer ini sudah nonaktif.");
    await expect(field.officer(page)).toBeFocused();
    await expect(page).toHaveURL(NEW_PATH);
  });

  test("criterion 1: server field errors appear under Telepon and Catatan; the same rules are checked before sending", async ({ page }) => {
    const creates = countCreates(page);
    await openNewForm(page);
    await field.name(page).fill(e2eName("Pasar Kramat Jati Blok B"));
    await field.officer(page).selectOption(officer.id);

    // The shared rules run inline first: a bad phone and a NIK in the note never reach the server.
    await field.contactPhone(page).fill("12345");
    await field.note(page).fill("NIK ketua 3201 2345 6789 0001");
    await saveButton(page).click();
    expect(await errorOf(page, field.contactPhone(page))).toBe("Nomor telepon tidak valid. Contoh: 0812 3456 7890");
    expect(await errorOf(page, field.note(page))).toBe("Jangan tulis NIK atau nomor rekening nasabah.");
    await expect(field.contactPhone(page)).toBeFocused();
    expect(creates.count).toBe(0);

    // The server's own field errors (its error shape, api.md) land under the same fields.
    await field.contactPhone(page).fill("0812 3456 7890");
    await field.note(page).fill("Minta brosur tabungan pelajar.");
    await page.route(
      (url) => url.pathname === "/api/prospects",
      (route) =>
        route.request().method() === "POST"
          ? route.fulfill({
              status: 400,
              contentType: "application/json",
              body: JSON.stringify({
                error: {
                  code: "validation",
                  message: "Periksa kembali isian yang ditandai.",
                  fields: {
                    "contact.phone": "Nomor telepon tidak valid. Contoh: 0812 3456 7890",
                    note: "Jangan tulis NIK atau nomor rekening nasabah.",
                  },
                },
              }),
            })
          : route.continue(),
    );
    await saveButton(page).click();
    await expect.poll(() => errorOf(page, field.contactPhone(page))).toBe("Nomor telepon tidak valid. Contoh: 0812 3456 7890");
    expect(await errorOf(page, field.note(page))).toBe("Jangan tulis NIK atau nomor rekening nasabah.");
    await expect(field.contactPhone(page)).toBeFocused();
    await expect(field.name(page)).toHaveValue(/Pasar Kramat Jati Blok B/);
  });

  test("criterion 2, EC2: with no active Funding Officer the form says to add one and links to Pengaturan → Funding Officer", async ({
    page,
  }) => {
    await page.route(
      (url) => url.pathname === "/api/funding-officers",
      (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ items: [{ ...officer, active: false }] }),
        }),
    );
    await page.goto(NEW_PATH);
    await expect(page.getByText(COPY.noActiveOfficers)).toBeVisible();
    await expect(field.name(page)).toHaveCount(0);
    const link = page.getByRole("link", { name: "Buka Pengaturan Funding Officer" });
    await expect(link).toHaveAttribute("href", "/pengaturan/funding-officer");
    if (!isDesktop(page)) await expectTouchTarget(link);
    await expectNoHorizontalScroll(page);
    await link.click();
    await expect(page).toHaveURL("/pengaturan/funding-officer");
  });

  test("the only active Funding Officer is preselected", async ({ page }) => {
    await page.route(
      (url) => url.pathname === "/api/funding-officers",
      (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ items: [officer, { ...officer, id: crypto.randomUUID(), name: "Agus Setiawan", active: false }] }),
        }),
    );
    await openNewForm(page);
    await expect(field.officer(page)).toHaveValue(officer.id);
    await expect(field.officer(page).locator("option")).toHaveCount(1);
  });

  test("criterion 3, EC33: 'Gunakan lokasi saya' fills the location from GPS, and it is saved", async ({ page, context }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: -6.4817, longitude: 106.854, accuracy: 12 });
    await openNewForm(page);
    await expect(locationLine(page)).toHaveText("Belum ada lokasi.");
    if (!isDesktop(page)) await expectTouchTarget(gpsButton(page));

    await gpsButton(page).click();
    await expect(locationLine(page)).toHaveText("-6.4817, 106.8540 (±12 m)");
    await page.getByText("Masukkan koordinat").click();
    await expect(field.lat(page)).toHaveValue("-6.4817");
    await expect(field.lng(page)).toHaveValue("106.854");

    const name = e2eName("SDN 3 Cibinong");
    await field.name(page).fill(name);
    await field.officer(page).selectOption(officer.id);
    const response = page.waitForResponse((res) => isCreate(res.request()));
    await saveButton(page).click();
    const { prospect } = await (await response).json();
    await expect(page).toHaveURL(`/prospect/${prospect.id}`);
    expect((await getProspect(page, prospect.id)).location).toEqual({ lat: -6.4817, lng: 106.854 });

    // "Hapus lokasi" is covered on the edit page below.
  });

  test("criterion 3, EC33: GPS denied says so, and tapping the map sets the location", async ({ page }) => {
    await stubGeolocation(page, "denied");
    await openNewForm(page);
    await gpsButton(page).click();
    await expect(page.getByText(COPY.gpsDenied)).toBeVisible();

    await tapMap(page);
    await expect(locationLine(page)).toHaveText(/^-?\d+\.\d{4}, \d+\.\d{4}$/);

    await page.getByRole("button", { name: "Hapus lokasi" }).click();
    await expect(locationLine(page)).toHaveText("Belum ada lokasi.");
  });

  test("criterion 3, EC33: GPS that times out says so; while waiting the button shows 'Mencari lokasi…'", async ({ page }) => {
    await stubGeolocation(page, "timeout");
    await openNewForm(page);
    await gpsButton(page).click();
    await expect(page.getByText(COPY.gpsFailed)).toBeVisible();
    await expect(gpsButton(page)).toHaveText("Gunakan lokasi saya");

    await tapMap(page, 1 / 3);
    await expect(locationLine(page)).toHaveText(/^-?\d+\.\d{4}, \d+\.\d{4}$/);
  });

  test("criterion 3, EC33: GPS that never answers keeps the button busy", async ({ page }) => {
    await stubGeolocation(page, "never");
    await openNewForm(page);
    await gpsButton(page).click();
    await expect(gpsButton(page)).toHaveText("Mencari lokasi…");
    await expect(gpsButton(page)).toBeDisabled();
  });

  test("criterion 4, EC12, EC42: the note counts to 500, stops at 500, and shows the customer-data hint", async ({ page }) => {
    await openNewForm(page);
    await expect(page.getByText("0/500")).toBeVisible();
    await expect(page.getByText(COPY.noteHint)).toBeVisible();
    await field.note(page).fill("Minta brosur tabungan pelajar.");
    await expect(page.getByText("30/500")).toBeVisible();

    await field.note(page).fill("a".repeat(600));
    await expect(field.note(page)).toHaveValue("a".repeat(500));
    await expect(page.getByText("500/500")).toBeVisible();
    await field.note(page).press("End");
    await field.note(page).pressSequentially("bcd");
    await expect(field.note(page)).toHaveValue("a".repeat(500));

    const describedBy = await field.note(page).getAttribute("aria-describedby");
    expect(describedBy).toMatch(/-hint/);
  });

  test("criterion 5, EC15: a double tap sends one create, and the button is disabled while saving", async ({ page }) => {
    const creates = countCreates(page);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(
      (url) => url.pathname === "/api/prospects",
      async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        await held;
        await route.continue();
      },
    );

    const name = e2eName("PT Sinar Logistik");
    await openNewForm(page);
    await field.name(page).fill(name);
    await field.officer(page).selectOption(officer.id);
    await saveButton(page).dblclick();

    await expect(saveButton(page)).toBeDisabled();
    await expect(saveButton(page)).toHaveText("Menyimpan…");
    release();
    await expect(page).toHaveURL(/\/prospect\/[0-9a-f-]{36}$/);
    await expect(page.getByText(COPY.saved)).toBeVisible();
    expect(creates.count).toBe(1);

    const list = await page.request.get(`/api/prospects?q=${encodeURIComponent(name)}`);
    expect((await list.json()).total).toBe(1);
  });

  test("criterion 6, EC14: a matching name shows a warning with a link; 'Tetap simpan' opens the new Prospect", async ({ page }) => {
    const name = e2eName("SDN 3 Cibinong");
    const existing = await createProspect(page, { name, fundingOfficerId: officer.id, category: "sekolah" });

    await openNewForm(page);
    await field.name(page).fill(`  ${name.toUpperCase()} `);
    await field.officer(page).selectOption(officer.id);
    const response = page.waitForResponse((res) => isCreate(res.request()));
    await saveButton(page).click();
    const { prospect } = await (await response).json();

    const warning = page.getByTestId("duplicate-warning");
    await expect(warning).toBeVisible();
    await expect(warning).toContainText(`Sudah ada Prospect bernama ${name.toUpperCase()}`);
    const link = warning.getByRole("link", { name: `Buka ${name}` });
    await expect(link).toHaveAttribute("href", `/prospect/${existing.id}`);
    await expect(page).toHaveURL(NEW_PATH);
    // Not saved again, and the form cannot be sent a second time from here.
    await expect(saveButton(page)).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    if (!isDesktop(page)) {
      await expectTouchTarget(warning.getByRole("button", { name: "Tetap simpan" }));
      await expectTouchTarget(link, 44);
    }

    await warning.getByRole("button", { name: "Tetap simpan" }).click();
    await expect(page).toHaveURL(`/prospect/${prospect.id}`);
    await expect(page.getByText(COPY.saved)).toBeVisible();
  });

  test("criterion 6, EC14: the link opens the existing Prospect; 'Batalkan Prospect baru' archives the new one", async ({ page }) => {
    const name = e2eName("Pasar Kramat Jati Blok B");
    const existing = await createProspect(page, { name, fundingOfficerId: officer.id });

    await openNewForm(page);
    await field.name(page).fill(name);
    await field.officer(page).selectOption(officer.id);
    const response = page.waitForResponse((res) => isCreate(res.request()));
    await saveButton(page).click();
    const { prospect } = await (await response).json();

    const warning = page.getByTestId("duplicate-warning");
    await warning.getByRole("button", { name: "Batalkan Prospect baru" }).click();
    await expect(page).toHaveURL("/prospect");
    await expect(page.getByText("Prospect baru dibatalkan dan diarsipkan.")).toBeVisible();
    expect((await getProspect(page, prospect.id)).archived).toBe(true);
    expect((await getProspect(page, existing.id)).archived).toBe(false);

    // Opening the existing one from the warning.
    const second = await createProspect(page, { name: e2eName("Koperasi Karyawan"), fundingOfficerId: officer.id });
    await openNewForm(page);
    await field.name(page).fill(second.name);
    await field.officer(page).selectOption(officer.id);
    await saveButton(page).click();
    await page.getByTestId("duplicate-warning").getByRole("link", { name: `Buka ${second.name}` }).click();
    await expect(page).toHaveURL(`/prospect/${second.id}`);
  });

  test("criterion 7, EC36: a failed save keeps every input, says so, and 'Coba lagi' saves once", async ({ page }) => {
    const creates = countCreates(page);
    let failNext = true;
    await page.route(
      (url) => url.pathname === "/api/prospects",
      (route) => {
        if (route.request().method() === "POST" && failNext) {
          failNext = false;
          return route.abort("internetdisconnected");
        }
        return route.continue();
      },
    );

    const name = e2eName("Kantor Kecamatan Tanah Sareal");
    await openNewForm(page);
    await field.name(page).fill(name);
    await field.officer(page).selectOption(officer.id);
    await field.category(page).selectOption("instansi");
    await field.address(page).fill("Jl. Raya Bogor Km 43");
    await field.contactName(page).fill("Ibu Sri Wahyuni");
    await field.contactRole(page).fill("Kepala Sekolah");
    await field.contactPhone(page).fill("0812 3456 7890");
    await field.potential(page).fill("1.250");
    await field.note(page).fill("Minta brosur tabungan pelajar.");
    await page.getByText("Masukkan koordinat").click();
    await field.lat(page).fill("-6.4817");
    await field.lng(page).fill("106.854");
    await saveButton(page).click();

    const alert = page.getByRole("alert").filter({ hasText: COPY.saveFailed });
    await expect(alert).toBeVisible();
    await expect(field.name(page)).toHaveValue(name);
    await expect(field.officer(page)).toHaveValue(officer.id);
    await expect(field.category(page)).toHaveValue("instansi");
    await expect(field.address(page)).toHaveValue("Jl. Raya Bogor Km 43");
    await expect(field.contactName(page)).toHaveValue("Ibu Sri Wahyuni");
    await expect(field.contactRole(page)).toHaveValue("Kepala Sekolah");
    await expect(field.contactPhone(page)).toHaveValue("0812 3456 7890");
    await expect(field.potential(page)).toHaveValue("1.250");
    await expect(field.note(page)).toHaveValue("Minta brosur tabungan pelajar.");
    await expect(locationLine(page)).toHaveText("-6.4817, 106.8540");
    await expect(saveButton(page)).toBeEnabled();

    const response = page.waitForResponse((res) => isCreate(res.request()) && res.ok());
    await alert.getByRole("button", { name: "Coba lagi" }).click();
    const { prospect } = await (await response).json();
    await expect(page).toHaveURL(`/prospect/${prospect.id}`);
    expect(creates.count).toBe(2);
    const saved = await getProspect(page, prospect.id);
    expect(saved).toMatchObject({
      name,
      category: "instansi",
      address: "Jl. Raya Bogor Km 43",
      location: { lat: -6.4817, lng: 106.854 },
      contact: { name: "Ibu Sri Wahyuni", role: "Kepala Sekolah", phone: "+6281234567890" },
      potentialAccounts: 1250,
      note: "Minta brosur tabungan pelajar.",
    });
  });

  test("edit: the form is prefilled, 'Hapus lokasi' and a change save with PATCH, and the detail opens", async ({ page }) => {
    const prospect = await createProspect(page, {
      name: e2eName("SDN 3 Cibinong"),
      fundingOfficerId: officer.id,
      category: "sekolah",
      address: "Jl. Raya Bogor Km 43",
      location: { lat: -6.4817, lng: 106.854 },
      contact: { name: "Ibu Sri Wahyuni", role: "Kepala Sekolah", phone: "0812 3456 7890" },
      potentialAccounts: 350,
      note: "Minta brosur tabungan pelajar.",
    });

    await page.goto(`/prospect/${prospect.id}/ubah`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ubah Prospect");
    await expect(field.name(page)).toHaveValue(prospect.name);
    await expect(field.officer(page)).toHaveValue(officer.id);
    await expect(field.category(page)).toHaveValue("sekolah");
    await expect(field.address(page)).toHaveValue("Jl. Raya Bogor Km 43");
    await expect(field.contactName(page)).toHaveValue("Ibu Sri Wahyuni");
    await expect(field.contactRole(page)).toHaveValue("Kepala Sekolah");
    await expect(field.contactPhone(page)).toHaveValue("0812-3456-7890");
    await expect(field.potential(page)).toHaveValue("350");
    await expect(field.note(page)).toHaveValue("Minta brosur tabungan pelajar.");
    await expect(locationLine(page)).toHaveText("-6.4817, 106.8540");

    await page.getByRole("button", { name: "Hapus lokasi" }).click();
    await field.potential(page).fill("420");
    await field.category(page).selectOption("");
    await saveButton(page).click();
    await expect(page).toHaveURL(`/prospect/${prospect.id}`);
    await expect(page.getByText(COPY.saved)).toBeVisible();
    const saved = await getProspect(page, prospect.id);
    expect(saved).toMatchObject({ potentialAccounts: 420, location: null, category: null, version: 2 });
  });

  test("criterion 7, EC18: a 409 on edit shows the reload message, keeps the inputs, and 'Muat ulang' loads the latest", async ({ page }) => {
    const prospect = await createProspect(page, { name: e2eName("SDN 3 Cibinong"), fundingOfficerId: officer.id });
    await page.goto(`/prospect/${prospect.id}/ubah`);
    await expect(field.name(page)).toHaveValue(prospect.name);

    // Another tab changes it in between.
    const other = await page.request.patch(`/api/prospects/${prospect.id}`, {
      data: { potentialAccounts: 900, version: prospect.version },
    });
    expect(other.status()).toBe(200);

    await field.potential(page).fill("350");
    await saveButton(page).click();
    const alert = page.getByRole("alert").filter({ hasText: COPY.conflict });
    await expect(alert).toBeVisible();
    await expect(field.potential(page)).toHaveValue("350");
    await expect(page).toHaveURL(`/prospect/${prospect.id}/ubah`);

    await alert.getByRole("button", { name: "Muat ulang" }).click();
    await expect(field.potential(page)).toHaveValue("900");
    await expect(page.getByText(COPY.conflict)).toHaveCount(0);

    await field.potential(page).fill("950");
    await saveButton(page).click();
    await expect(page).toHaveURL(`/prospect/${prospect.id}`);
    expect((await getProspect(page, prospect.id)).potentialAccounts).toBe(950);
  });

  test("EC13: a location outside Indonesia typed as coordinates says so under the map", async ({ page }) => {
    const creates = countCreates(page);
    await openNewForm(page);
    await field.name(page).fill(e2eName("SDN 3 Cibinong"));
    await field.officer(page).selectOption(officer.id);
    await page.getByText("Masukkan koordinat").click();
    await field.lat(page).fill("-33.8688");
    await field.lng(page).fill("151.2093");
    await expect(locationLine(page)).toHaveText("-33.8688, 151.2093");
    await saveButton(page).click();

    await expect(page.getByText(COPY.outside)).toBeVisible();
    expect(await errorOf(page, field.lat(page))).toBe(COPY.outside);
    expect(creates.count).toBe(0);
  });

  test("EC10: Potensi rekening that is not a whole number says so", async ({ page }) => {
    await openNewForm(page);
    await field.name(page).fill(e2eName("SDN 3 Cibinong"));
    await field.officer(page).selectOption(officer.id);
    await field.potential(page).fill("12,5");
    await saveButton(page).click();
    expect(await errorOf(page, field.potential(page))).toBe("Potensi rekening harus bilangan bulat 0 sampai 100.000.");
  });

  test("responsive: no horizontal scroll, 44 px targets, and Simpan within reach above the navigation", async ({ page }) => {
    await openNewForm(page);
    await expectNoHorizontalScroll(page);
    await expect(page.getByText("* wajib diisi")).toBeVisible();

    if (isDesktop(page)) {
      // Desktop: two columns, the map on the right; Simpan and Batal at the end of the form, not sticky.
      const nameBox = (await field.name(page).boundingBox())!;
      const mapBox = (await map(page).boundingBox())!;
      expect(mapBox.x).toBeGreaterThan(nameBox.x + nameBox.width);
      expect(Math.round(mapBox.height)).toBe(360);
      await expect(page.getByRole("link", { name: "Batal" })).toBeVisible();
      const position = await saveButton(page).evaluate((element) => getComputedStyle(element.parentElement!.parentElement!).position);
      expect(position).toBe("static");
      return;
    }

    for (const locator of [
      field.name(page),
      field.officer(page),
      field.category(page),
      gpsButton(page),
      field.address(page),
      field.contactPhone(page),
      field.potential(page),
      saveButton(page),
    ]) {
      await locator.scrollIntoViewIfNeeded();
      await expectTouchTarget(locator);
    }
    expect(Math.round((await map(page).boundingBox())!.height)).toBe(200);

    // The sticky Simpan sits above the bottom navigation, at the top of the page and at the end.
    const nav = page.getByRole("navigation", { name: "Navigasi utama" });
    for (const scroll of [0, 100_000]) {
      await page.evaluate((y) => window.scrollTo(0, y), scroll);
      const save = (await saveButton(page).boundingBox())!;
      const navBox = (await nav.boundingBox())!;
      expect(save.y + save.height).toBeLessThanOrEqual(navBox.y);
      expect(save.y).toBeGreaterThan(0);
      await expect(saveButton(page)).toBeInViewport();
    }
    // The last field is reachable: the note is not hidden behind the bar.
    await field.note(page).scrollIntoViewIfNeeded();
    const note = (await field.note(page).boundingBox())!;
    const bar = (await saveButton(page).boundingBox())!;
    expect(note.y + note.height).toBeLessThanOrEqual(bar.y);
  });
});
