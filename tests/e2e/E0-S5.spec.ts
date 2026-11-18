import { expect, test, type Page } from "@playwright/test";
import { E2E_ADMIN, signInAsAdmin } from "./support/admin";
import { expectNoHorizontalScroll, expectTouchTarget } from "./support/responsive";

// E0-S5: the sign-in screen. Wrong-password and lockout tests use synthetic emails that have no account
// (unknown emails get the same 401 and lockout, api.md), so the shared e2e Admin is never locked out.

const COPY = {
  invalid: "Email atau kata sandi salah.",
  locked: "Terlalu banyak percobaan. Coba lagi dalam 15 menit.",
  network: "Tidak bisa terhubung. Periksa koneksi, lalu coba lagi.",
};

const unknownEmail = (label: string) =>
  `${label}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}@contoh.id`;

const emailField = (page: Page) => page.getByLabel("Email", { exact: true });
const passwordField = (page: Page) => page.getByLabel("Kata sandi", { exact: true });
// Scoped to the form: Next.js renders its own route announcer with role="alert".
const formAlert = (page: Page) => page.locator("form").getByRole("alert");
const submit = (page: Page) => page.getByRole("button", { name: "Masuk", exact: true });

async function fillAndSubmit(page: Page, email: string, password: string) {
  await emailField(page).fill(email);
  await passwordField(page).fill(password);
  await submit(page).click();
}

test.describe("E0-S5 sign-in screen", () => {
  test("shows the title, the labelled fields and no horizontal scroll", async ({ page }) => {
    await page.goto("/masuk");
    await expect(page).toHaveTitle("BFTM Planner");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("BFTM Planner");
    await expect(page.getByText("Masuk untuk mengelola Prospect dan Pipeline tim.")).toBeVisible();
    await expect(emailField(page)).toHaveAttribute("type", "email");
    await expect(emailField(page)).toHaveAttribute("autocomplete", "username");
    await expect(passwordField(page)).toHaveAttribute("type", "password");
    await expect(passwordField(page)).toHaveAttribute("autocomplete", "current-password");
    // No app shell on this screen.
    await expect(page.getByRole("navigation", { name: "Navigasi utama" })).toHaveCount(0);
    await expectNoHorizontalScroll(page);

    const box = await submit(page).boundingBox();
    expect(box!.height).toBe(48);
    if ((page.viewportSize()?.width ?? 0) < 1024) {
      await expectTouchTarget(submit(page));
      await expectTouchTarget(page.getByRole("button", { name: "Tampilkan kata sandi" }));
      await expectTouchTarget(emailField(page));
      await expectTouchTarget(passwordField(page));
    }
  });

  test("criterion 1: a signed-out visit returns to the page asked for after signing in", async ({ page }) => {
    await page.goto("/prospect");
    await expect(page).toHaveURL("/masuk?next=%2Fprospect");
    await fillAndSubmit(page, E2E_ADMIN.email, E2E_ADMIN.password);
    await expect(page).toHaveURL("/prospect");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Prospect");
  });

  test("criterion 1: with no page asked for, the Admin lands on the dashboard; Enter submits", async ({ page }) => {
    await page.goto("/masuk");
    await emailField(page).fill(E2E_ADMIN.email);
    await passwordField(page).fill(E2E_ADMIN.password);
    await passwordField(page).press("Enter");
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Dasbor");
  });

  test("EC39: a next that is not a same-site path ends on the dashboard", async ({ page }) => {
    await page.goto("/masuk?next=%2F%2Fevil.com");
    await fillAndSubmit(page, E2E_ADMIN.email, E2E_ADMIN.password);
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Dasbor");
  });

  test("criterion 2: wrong credentials show the message, keep the email and clear the password", async ({ page }) => {
    const email = unknownEmail("salah");
    await page.goto("/masuk");
    await fillAndSubmit(page, email, "kata-sandi-keliru");
    const alert = formAlert(page);
    await expect(alert).toHaveText(COPY.invalid);
    await expect(emailField(page)).toHaveValue(email);
    await expect(passwordField(page)).toHaveValue("");
    await expect(passwordField(page)).toBeFocused();
    await expect(page).toHaveURL("/masuk");
    await expectNoHorizontalScroll(page);
  });

  test("criterion 3, EC41: a locked-out email shows the lockout message", async ({ page }) => {
    const email = unknownEmail("terkunci");
    await page.goto("/masuk");
    // Five failures through the real endpoint lock the email; the sixth attempt, through the form, is refused.
    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await page.request.post("/api/auth/sign-in", { data: { email, password: "keliru-123" } });
      expect(response.status()).toBe(401);
    }
    await fillAndSubmit(page, email, "keliru-123");
    await expect(formAlert(page)).toHaveText(COPY.locked);
    await expect(emailField(page)).toHaveValue(email);
  });

  test("criterion 4: the button is disabled while signing in", async ({ page }) => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/auth/sign-in", async (route) => {
      await held;
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "invalid_credentials", message: COPY.invalid } }),
      });
    });
    await page.goto("/masuk");
    await fillAndSubmit(page, unknownEmail("tertahan"), "apa-saja-123");

    const pendingButton = page.getByRole("button", { name: "Memproses…" });
    await expect(pendingButton).toBeDisabled();
    await expect(emailField(page)).toHaveAttribute("readonly", "");
    await expect(passwordField(page)).toHaveAttribute("readonly", "");

    release();
    await expect(submit(page)).toBeEnabled();
    await expect(formAlert(page)).toHaveText(COPY.invalid);
  });

  test("empty fields show which field is missing and send nothing", async ({ page }) => {
    let requests = 0;
    await page.route("**/api/auth/sign-in", (route) => {
      requests++;
      return route.continue();
    });
    await page.goto("/masuk");
    await submit(page).click();
    await expect(page.getByText("Email wajib diisi", { exact: true })).toBeVisible();
    await expect(page.getByText("Kata sandi wajib diisi", { exact: true })).toBeVisible();
    await expect(emailField(page)).toHaveAttribute("aria-invalid", "true");
    await expect(emailField(page)).toBeFocused();
    expect(requests).toBe(0);
  });

  test("a network failure shows the message and keeps both fields", async ({ page }) => {
    await page.route("**/api/auth/sign-in", (route) => route.abort("internetdisconnected"));
    const email = unknownEmail("putus");
    await page.goto("/masuk");
    await fillAndSubmit(page, email, "kata-sandi-123");
    await expect(formAlert(page)).toHaveText(COPY.network);
    await expect(emailField(page)).toHaveValue(email);
    await expect(passwordField(page)).toHaveValue("kata-sandi-123");
    await expect(submit(page)).toBeEnabled();
  });

  test("the show-password toggle switches the field and its label", async ({ page }) => {
    await page.goto("/masuk");
    await passwordField(page).fill("rahasia-123");
    await page.getByRole("button", { name: "Tampilkan kata sandi" }).click();
    await expect(passwordField(page)).toHaveAttribute("type", "text");
    await page.getByRole("button", { name: "Sembunyikan kata sandi" }).click();
    await expect(passwordField(page)).toHaveAttribute("type", "password");
  });

  test("criterion 5: a signed-in Admin who opens the sign-in screen is sent to the dashboard", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/masuk");
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Dasbor");

    await page.goto("/masuk?next=%2F%2Fevil.com");
    await expect(page).toHaveURL("/");
  });
});
