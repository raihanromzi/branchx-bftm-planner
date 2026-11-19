import { expect, test, type Locator, type Page } from "@playwright/test";
import { signInAsAdmin } from "./support/admin";
import { createFundingOfficer, e2eName } from "./support/funding-officers";
import { createProspect } from "./support/prospects";
import { expectNoHorizontalScroll, expectTouchTarget } from "./support/responsive";

// E3-S2: Pengaturan → Template Pipeline, the list and the editor. Signed in as the e2e Admin against the dev
// server's database. Every test makes its own templates with the e2e marker (global-setup.ts removes them),
// and never edits or archives the default template "Umum", so tests run in parallel.
//
// Responses the UI cannot produce on its own (an empty-Stages 400, a 409 conflict, the empty and error list)
// are replaced with page.route; the screen's own code still runs.

const LIST = "/pengaturan/template-pipeline";
const COPY = {
  onlyNew: "Perubahan hanya berlaku untuk Pipeline baru.",
  noStages: "Tambahkan minimal satu Stage.",
  conflict: "Data ini sudah diubah. Muat ulang untuk melihat versi terbaru.",
  stageRequired: "Nama Tahap wajib diisi.",
  listError: "Daftar Template Pipeline gagal dimuat.",
  empty: "Belum ada Template Pipeline. Template menentukan Tahap dan Tugas yang dilalui setiap Pipeline.",
  inUse: "Template ini dipakai Pipeline. Arsipkan saja.",
};

type Template = { id: string; name: string; version: number; pipelineCount: number; archived: boolean };
type StageInput = { name: string; tasks?: { name: string }[] };

const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1024;

async function createTemplate(page: Page, name: string, stages: StageInput[]): Promise<Template> {
  const response = await page.request.post("/api/pipeline-templates", {
    headers: { "idempotency-key": crypto.randomUUID() },
    data: { name, stages },
  });
  expect(response.status(), `create ${name}`).toBe(201);
  return (await response.json()) as Template;
}

async function getTemplate(page: Page, id: string) {
  const response = await page.request.get(`/api/pipeline-templates/${id}`);
  expect(response.status()).toBe(200);
  return (await response.json()) as Template & { stages: { name: string; tasks: { name: string }[] }[] };
}

/** Starts a Pipeline from the template on a fresh e2e Prospect, so the template counts as used. */
async function useTemplate(page: Page, templateId: string) {
  const officer = await createFundingOfficer(page, e2eName("Rina Kartika"));
  const prospect = await createProspect(page, { name: e2eName("SDN 3 Cibinong"), fundingOfficerId: officer.id });
  const response = await page.request.post("/api/pipelines", {
    headers: { "idempotency-key": crypto.randomUUID() },
    data: { prospectId: prospect.id, templateId },
  });
  expect(response.status()).toBe(201);
}

const THREE_STAGES: StageInput[] = [
  { name: "Identifikasi", tasks: [{ name: "Cari data sekolah" }, { name: "Hubungi kepala sekolah" }] },
  { name: "Pendekatan", tasks: [{ name: "Jadwalkan kunjungan" }] },
  { name: "Presentasi" },
];

/** A template's row: a list row below 1024 px, a table row from 1024 px. */
function row(page: Page, name: string): Locator {
  return isDesktop(page)
    ? page.getByRole("row").filter({ hasText: name })
    : page.getByRole("list", { name: "Daftar Template Pipeline" }).getByRole("listitem").filter({ hasText: name });
}

const stageInput = (page: Page, position: number) => page.getByLabel(`Nama Tahap ${position}`, { exact: true });
const stageNames = (page: Page) =>
  page.getByRole("list", { name: "Tahap di template ini" }).locator("[data-testid=template-stage] > div:first-child textarea");
const saveButton = (page: Page) => page.getByRole("button", { name: "Simpan", exact: true });
/** "Arsipkan", "Pulihkan", "Hapus": in the header from 1024 px, in the editor's own section below. */
function templateAction(page: Page, name: "Arsipkan" | "Pulihkan" | "Hapus"): Locator {
  return page.getByRole("button", { name, exact: true }).locator("visible=true").first();
}

async function openEditor(page: Page, template: Template) {
  await page.goto(`${LIST}/${template.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ubah Template");
}

async function expectSavedAndListed(page: Page) {
  await expect(page).toHaveURL(LIST);
  await expect(page.getByText("Template disimpan.")).toBeVisible();
}

test.describe("E3-S2 Pipeline Template screen", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test("criterion 1: the list shows each template's Stage count, Pipelines using it and the Diarsipkan label", async ({ page }) => {
    const used = await createTemplate(page, e2eName("Sekolah"), THREE_STAGES);
    await useTemplate(page, used.id);
    const archived = await createTemplate(page, e2eName("Pasar Tradisional"), [{ name: "Identifikasi" }]);
    await page.request.post(`/api/pipeline-templates/${archived.id}/archive`, { data: { version: archived.version } });

    await page.goto(LIST);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Template Pipeline");
    await expect(row(page, used.name)).toContainText("3 Tahap");
    await expect(row(page, used.name)).toContainText("1 Pipeline memakai");
    await expect(row(page, used.name)).not.toContainText("Diarsipkan");
    await expect(row(page, archived.name)).toContainText("1 Tahap");
    await expect(row(page, archived.name)).toContainText("0 Pipeline memakai");
    await expect(row(page, archived.name)).toContainText("Diarsipkan");
    await expectNoHorizontalScroll(page);

    // The row opens the editor.
    await row(page, used.name).getByRole("link", { name: used.name }).click();
    await expect(page).toHaveURL(`${LIST}/${used.id}`);
    await expect(stageInput(page, 1)).toHaveValue("Identifikasi");
  });

  test("criterion 1: empty and error states", async ({ page }) => {
    let fail = true;
    await page.route("**/api/pipeline-templates", (route) =>
      fail
        ? route.fulfill({ status: 500, contentType: "application/json", body: "{}" })
        : route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) }),
    );
    await page.goto(LIST);
    await expect(page.getByRole("alert").filter({ hasText: COPY.listError })).toBeVisible();
    fail = false;
    await page.getByRole("button", { name: "Coba lagi" }).click();
    await expect(page.getByText(COPY.empty)).toBeVisible();
    await expect(page.getByRole("link", { name: "Tambah Template" })).toBeVisible();
  });

  test("criterion 2: creates a template with Stages and Tasks", async ({ page }) => {
    const name = e2eName("Sekolah");
    await page.goto(LIST);
    await (isDesktop(page)
      ? page.locator("header").getByRole("link", { name: "Tambah Template" })
      : page.getByRole("link", { name: "Tambah", exact: true })
    ).click();
    await expect(page).toHaveURL(`${LIST}/baru`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tambah Template");

    await page.getByLabel("Nama template").fill(name);
    // A new template starts with one empty Stage.
    await expect(stageNames(page)).toHaveCount(1);
    await stageInput(page, 1).fill("Identifikasi");
    await page.getByRole("button", { name: "Tambah Tugas di Identifikasi" }).click();
    await expect(page.getByLabel("Tugas 1 di Identifikasi")).toBeFocused();
    await page.getByLabel("Tugas 1 di Identifikasi").fill("Cari data sekolah");
    await page.getByRole("button", { name: "Tambah Tugas di Identifikasi" }).click();
    await page.getByLabel("Tugas 2 di Identifikasi").fill("Hubungi kepala sekolah");
    await page.getByRole("button", { name: "Tambah Tahap" }).click();
    await expect(stageInput(page, 2)).toBeFocused();
    await stageInput(page, 2).fill("Presentasi");
    await saveButton(page).click();
    await expectSavedAndListed(page);
    await expect(row(page, name)).toContainText("2 Tahap");

    const { items } = (await (await page.request.get("/api/pipeline-templates")).json()) as { items: Template[] };
    const saved = await getTemplate(page, items.find((item) => item.name === name)!.id);
    expect(saved.stages.map((stage) => [stage.name, stage.tasks.map((task) => task.name)])).toEqual([
      ["Identifikasi", ["Cari data sekolah", "Hubungi kepala sekolah"]],
      ["Presentasi", []],
    ]);
  });

  test("criterion 2: renames, adds, removes and reorders Stages and Tasks with buttons", async ({ page }) => {
    const template = await createTemplate(page, e2eName("Sekolah"), THREE_STAGES);
    await openEditor(page, template);

    // Rename a Stage and a Task.
    await stageInput(page, 3).fill("Presentasi Produk");
    await page.getByLabel("Tugas 1 di Pendekatan").fill("Jadwalkan kunjungan pertama");
    // Add a Stage, then remove "Pendekatan".
    await page.getByRole("button", { name: "Tambah Tahap" }).click();
    await stageInput(page, 4).fill("Negosiasi");
    await page.getByRole("button", { name: "Aksi untuk Pendekatan" }).click();
    await page.getByRole("menuitem", { name: "Hapus Tahap" }).click();
    await expect(stageNames(page)).toHaveCount(3);
    // Remove a Task, and move the remaining order: "Negosiasi" up one.
    await page.getByRole("button", { name: "Hapus tugas Cari data sekolah" }).click();
    await page.getByRole("button", { name: "Pindahkan Negosiasi ke atas" }).click();
    await expect(stageNames(page)).toHaveText(["Identifikasi", "Negosiasi", "Presentasi Produk"].map((text) => new RegExp(`^${text}$`)));
    // Reorder Tasks with the Task menu.
    await page.getByRole("button", { name: "Tambah Tugas di Negosiasi" }).click();
    await page.getByLabel("Tugas 1 di Negosiasi").fill("Bahas jumlah rekening");
    await page.getByRole("button", { name: "Tambah Tugas di Negosiasi" }).click();
    await page.getByLabel("Tugas 2 di Negosiasi").fill("Sepakati jadwal pembukaan");
    await page.getByRole("button", { name: "Aksi untuk tugas Sepakati jadwal pembukaan" }).click();
    await page.getByRole("menuitem", { name: "Pindahkan ke atas" }).click();
    await expect(page.getByTestId("template-announcer")).toHaveText("Sepakati jadwal pembukaan sekarang tugas 1 di Negosiasi.");
    await expect(page.getByLabel("Tugas 1 di Negosiasi")).toHaveValue("Sepakati jadwal pembukaan");

    await saveButton(page).click();
    await expectSavedAndListed(page);
    const saved = await getTemplate(page, template.id);
    expect(saved.stages.map((stage) => [stage.name, stage.tasks.map((task) => task.name)])).toEqual([
      ["Identifikasi", ["Hubungi kepala sekolah"]],
      ["Negosiasi", ["Sepakati jadwal pembukaan", "Bahas jumlah rekening"]],
      ["Presentasi Produk", []],
    ]);
  });

  test("criterion 2: keyboard reordering keeps focus on the moved Stage and announces its place", async ({ page }) => {
    const template = await createTemplate(page, e2eName("Sekolah"), THREE_STAGES);
    await openEditor(page, template);

    const down = page.getByRole("button", { name: "Pindahkan Identifikasi ke bawah" });
    await down.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("template-announcer")).toHaveText("Identifikasi sekarang tahap 2.");
    await expect(down).toBeFocused();
    await expect(stageInput(page, 2)).toHaveValue("Identifikasi");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("template-announcer")).toHaveText("Identifikasi sekarang tahap 3.");
    // At the last place "ke bawah" is disabled, so focus moves to the same Stage's "ke atas".
    await expect(page.getByRole("button", { name: "Pindahkan Identifikasi ke atas" })).toBeFocused();
    await expect(down).toBeDisabled();
    await expect(stageInput(page, 3)).toHaveValue("Identifikasi");
  });

  test("criterion 2: the move buttons are 44 px touch targets, and the last Stage cannot be removed", async ({ page }) => {
    test.skip(isDesktop(page), "touch targets are checked on mobile and tablet");
    const template = await createTemplate(page, e2eName("Sekolah"), [{ name: "Identifikasi", tasks: [{ name: "Cari data sekolah" }] }]);
    await openEditor(page, template);
    await expectTouchTarget(page.getByRole("button", { name: "Pindahkan Identifikasi ke atas" }));
    await expectTouchTarget(page.getByRole("button", { name: "Pindahkan Identifikasi ke bawah" }));
    await expectTouchTarget(page.getByRole("button", { name: "Aksi untuk Identifikasi" }));
    await expectTouchTarget(page.getByRole("button", { name: "Hapus tugas Cari data sekolah" }));
    await expectTouchTarget(page.getByRole("button", { name: "Tambah Tugas di Identifikasi" }));
    await expectTouchTarget(saveButton(page));
    await expectNoHorizontalScroll(page);

    // Touch: tapping the move button reorders (mobile has no drag handle; the buttons are the touch control).
    await page.getByRole("button", { name: "Tambah Tahap" }).tap();
    await stageInput(page, 2).fill("Pendekatan");
    await page.getByRole("button", { name: "Pindahkan Pendekatan ke atas" }).tap();
    await expect(stageInput(page, 1)).toHaveValue("Pendekatan");

    // EC3 in the UI: with one Stage, "Hapus Tahap" is disabled.
    await page.getByRole("button", { name: "Aksi untuk Pendekatan" }).tap();
    await page.getByRole("menuitem", { name: "Hapus Tahap" }).tap();
    await expect(stageNames(page)).toHaveCount(1);
    await page.getByRole("button", { name: "Aksi untuk Identifikasi" }).tap();
    await expect(page.getByRole("menuitem", { name: "Hapus Tahap" })).toBeDisabled();
    await expect(page.getByText("Template perlu minimal satu Tahap.")).toBeVisible();
  });

  test("criterion 2: drag reorders Stages by the handle (tablet and desktop)", async ({ page }) => {
    test.skip(!isDesktop(page), "drag with a mouse is checked on desktop; tablet uses the same handle");
    const template = await createTemplate(page, e2eName("Sekolah"), THREE_STAGES);
    await openEditor(page, template);
    const handle = page.getByRole("button", { name: "Seret untuk memindahkan Presentasi" });
    const target = page.getByRole("button", { name: "Seret untuk memindahkan Identifikasi" });
    const from = (await handle.boundingBox())!;
    const to = (await target.boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 - 10, { steps: 3 });
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2 - 10, { steps: 12 });
    await page.mouse.up();
    await expect(page.getByTestId("template-announcer")).toHaveText("Presentasi sekarang tahap 1.");
    await expect(stageInput(page, 1)).toHaveValue("Presentasi");
    await expect(stageInput(page, 2)).toHaveValue("Identifikasi");
  });

  test("criterion 3: a server answer of no Stages shows 'Tambahkan minimal satu Stage.' at the top of the list (EC3)", async ({ page }) => {
    await page.route("**/api/pipeline-templates", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({
            status: 400,
            contentType: "application/json",
            body: JSON.stringify({
              error: { code: "validation", message: "Periksa kembali isian yang ditandai.", fields: { stages: COPY.noStages } },
            }),
          })
        : route.continue(),
    );
    await page.goto(`${LIST}/baru`);
    await page.getByLabel("Nama template").fill(e2eName("Sekolah"));
    await stageInput(page, 1).fill("Identifikasi");
    await saveButton(page).click();
    const error = page.getByTestId("stages-error");
    await expect(error).toHaveText(COPY.noStages);
    await expect(error).toBeFocused();
    await expect(page).toHaveURL(`${LIST}/baru`);
  });

  test("criterion 2: a field error from the server shows under the Stage name it belongs to", async ({ page }) => {
    const template = await createTemplate(page, e2eName("Sekolah"), THREE_STAGES);
    await page.route(`**/api/pipeline-templates/${template.id}`, (route) =>
      route.request().method() === "PUT"
        ? route.fulfill({
            status: 400,
            contentType: "application/json",
            body: JSON.stringify({
              error: { code: "validation", message: "Periksa kembali isian yang ditandai.", fields: { "stages.1.name": COPY.stageRequired } },
            }),
          })
        : route.continue(),
    );
    await openEditor(page, template);
    await saveButton(page).click();
    await expect(stageInput(page, 2)).toBeFocused();
    await expect(stageInput(page, 2)).toHaveAttribute("aria-invalid", "true");
    await expect(stageInput(page, 2)).toHaveAccessibleDescription(COPY.stageRequired);
    await expect(page.getByText(COPY.stageRequired)).toHaveCount(1);
  });

  test("criterion 2: a blank Stage name is caught before saving", async ({ page }) => {
    const template = await createTemplate(page, e2eName("Sekolah"), THREE_STAGES);
    await openEditor(page, template);
    await stageInput(page, 3).fill("");
    await saveButton(page).click();
    await expect(stageInput(page, 3)).toBeFocused();
    await expect(stageInput(page, 3)).toHaveAccessibleDescription(COPY.stageRequired);
  });

  test("criterion 4: the editor says changes apply only to new Pipelines (EC21)", async ({ page }) => {
    await page.goto(`${LIST}/baru`);
    await expect(page.getByText(COPY.onlyNew)).toBeVisible();
    const template = await createTemplate(page, e2eName("Sekolah"), THREE_STAGES);
    await openEditor(page, template);
    await expect(page.getByText(COPY.onlyNew)).toBeVisible();
    await expect(page.getByLabel("Nama template")).toHaveAccessibleDescription(COPY.onlyNew);
  });

  test("criterion 5: archive makes it read-only with Pulihkan, and restore makes it editable again (EC21)", async ({ page }) => {
    const template = await createTemplate(page, e2eName("Sekolah"), THREE_STAGES);
    await openEditor(page, template);
    await templateAction(page, "Arsipkan").click();
    await expect(page.getByTestId("archived-notice")).toBeVisible();
    await expect(page.getByText("Template diarsipkan.")).toBeVisible();
    await expect(saveButton(page)).toHaveCount(0);
    await expect(page.getByLabel("Nama template")).toHaveCount(0);
    await expect(page.getByText(COPY.onlyNew)).toBeVisible();
    await expectNoHorizontalScroll(page);

    await page.goto(LIST);
    await expect(row(page, template.name)).toContainText("Diarsipkan");

    await openEditor(page, template);
    await expect(page.getByTestId("archived-notice")).toBeVisible();
    await templateAction(page, "Pulihkan").click();
    await expect(page.getByText("Template dipulihkan.")).toBeVisible();
    await expect(stageInput(page, 1)).toHaveValue("Identifikasi");
    expect((await getTemplate(page, template.id)).archived).toBe(false);
  });

  test("criterion 5: Hapus is offered for an unused template and deletes after a confirm", async ({ page }) => {
    const template = await createTemplate(page, e2eName("Sekolah"), THREE_STAGES);
    await openEditor(page, template);
    await templateAction(page, "Hapus").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(`Hapus template ${template.name}?`);
    await dialog.getByRole("button", { name: "Batal" }).click();
    await expect(dialog).toBeHidden();

    await templateAction(page, "Hapus").click();
    await page.getByRole("dialog").getByRole("button", { name: "Hapus", exact: true }).click();
    await expect(page).toHaveURL(LIST);
    await expect(page.getByText("Template dihapus.")).toBeVisible();
    expect((await page.request.get(`/api/pipeline-templates/${template.id}`)).status()).toBe(404);
  });

  test("criterion 5: Hapus is hidden when a Pipeline uses the template; a race shows the in-use message", async ({ page }) => {
    const used = await createTemplate(page, e2eName("Sekolah"), THREE_STAGES);
    await useTemplate(page, used.id);
    await openEditor(page, used);
    await expect(templateAction(page, "Arsipkan")).toBeVisible();
    await expect(page.getByRole("button", { name: "Hapus", exact: true })).toHaveCount(0);

    // Unused when opened, used by the time Hapus is confirmed.
    const racing = await createTemplate(page, e2eName("Pasar"), THREE_STAGES);
    await openEditor(page, racing);
    await useTemplate(page, racing.id);
    await templateAction(page, "Hapus").click();
    await page.getByRole("dialog").getByRole("button", { name: "Hapus", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText(COPY.inUse);
  });

  test("EC18: a version conflict shows the reload message, and Muat ulang loads the latest", async ({ page }) => {
    const template = await createTemplate(page, e2eName("Sekolah"), THREE_STAGES);
    await openEditor(page, template);
    // The editor must hold the old version before the other save, or it loads the new one and no conflict happens.
    await expect(stageInput(page, 1)).toHaveValue("Identifikasi");
    // Someone else saves meanwhile.
    const latest = await getTemplate(page, template.id);
    const renamed = await page.request.put(`/api/pipeline-templates/${template.id}`, {
      data: { name: template.name, stages: [{ name: "Tahap Baru" }], version: latest.version },
    });
    expect(renamed.status()).toBe(200);

    await stageInput(page, 1).fill("Identifikasi Awal");
    await saveButton(page).click();
    await expect(page.getByRole("alert").filter({ hasText: COPY.conflict })).toBeVisible();
    await page.getByRole("button", { name: "Muat ulang" }).click();
    await expect(stageInput(page, 1)).toHaveValue("Tahap Baru");
    await expect(stageNames(page)).toHaveCount(1);
  });

  test("409 template_name_taken shows under the name", async ({ page }) => {
    const existing = await createTemplate(page, e2eName("Sekolah"), THREE_STAGES);
    await page.goto(`${LIST}/baru`);
    await page.getByLabel("Nama template").fill(existing.name);
    await stageInput(page, 1).fill("Identifikasi");
    await saveButton(page).click();
    await expect(page.getByLabel("Nama template")).toBeFocused();
    await expect(page.getByLabel("Nama template")).toHaveAccessibleDescription(new RegExp("^Nama template sudah dipakai\\."));
  });

  test("leaving with unsaved changes asks 'Buang perubahan?'", async ({ page }) => {
    const template = await createTemplate(page, e2eName("Sekolah"), THREE_STAGES);
    await openEditor(page, template);
    await stageInput(page, 1).fill("Identifikasi Ulang");
    await page.getByRole("link", { name: "Kembali" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Buang perubahan?");
    await dialog.getByRole("button", { name: "Lanjut mengubah" }).click();
    await expect(page).toHaveURL(`${LIST}/${template.id}`);
    await expect(stageInput(page, 1)).toHaveValue("Identifikasi Ulang");

    await page.getByRole("link", { name: "Kembali" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Buang perubahan" }).click();
    await expect(page).toHaveURL(LIST);
    expect((await getTemplate(page, template.id)).stages[0].name).toBe("Identifikasi");
  });

  test("layout: no horizontal scroll with long names, and Simpan stays reachable above the navigation", async ({ page }) => {
    const longStage = "Pembukaan Rekening Kolektif untuk Seluruh Guru dan Tenaga Kependidikan".slice(0, 60);
    const longTask =
      "Kumpulkan fotokopi KTP dan surat keterangan kerja dari bagian kepegawaian sekolah, lalu periksa kelengkapan berkas satu per satu".slice(0, 120);
    const stages = Array.from({ length: 8 }, (_, index) => ({
      name: index === 3 ? longStage : `Tahap ${index + 1}`,
      tasks: [{ name: longTask }, { name: "Hubungi kepala sekolah" }],
    }));
    const template = await createTemplate(page, e2eName("Sekolah Dasar Negeri dan Madrasah Ibtidaiyah Kecamatan Cibinong"), stages);
    await openEditor(page, template);
    await expectNoHorizontalScroll(page);

    const save = saveButton(page);
    if (!isDesktop(page)) {
      await expect(save).toBeInViewport();
      const box = (await save.boundingBox())!;
      const viewport = page.viewportSize()!;
      // Sticky above the bottom navigation, while the editor is scrolled to the top.
      const nav = (await page.getByRole("navigation", { name: "Navigasi utama" }).locator("visible=true").boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(nav.y + 1);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
      await expectTouchTarget(save);
    } else {
      // From 1024 px "Simpan" and "Batal" sit at the bottom of the editor.
      await save.scrollIntoViewIfNeeded();
      await expect(save).toBeInViewport();
      await expect(page.getByRole("link", { name: "Batal" })).toBeInViewport();
    }
    // The last Stage's controls stay reachable above the sticky bar.
    const lastAdd = page.getByRole("button", { name: "Tambah Tahap" });
    await lastAdd.scrollIntoViewIfNeeded();
    await lastAdd.click();
    await expect(stageInput(page, 9)).toBeFocused();
  });
});
