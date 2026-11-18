// The synthetic Admin the end-to-end tests sign in as. Seeded by global-setup.ts into the database the
// dev server uses (local bftm_dev, or the CI service database); never a Neon database.
export const E2E_ADMIN = {
  email: "admin.e2e@contoh.id",
  password: "uji-e2e-kata-sandi-123",
} as const;

/** Signs the page's browser context in as the e2e Admin, through the real sign-in endpoint. */
export async function signInAsAdmin(page: import("@playwright/test").Page) {
  const response = await page.request.post("/api/auth/sign-in", {
    data: { email: E2E_ADMIN.email, password: E2E_ADMIN.password },
  });
  if (response.status() !== 200) throw new Error(`Sign-in for the e2e Admin failed with ${response.status()}`);
}
