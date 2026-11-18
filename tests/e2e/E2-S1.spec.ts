import { expect, test } from "@playwright/test";
import { signInAsAdmin } from "./support/admin";
import { createFundingOfficer, e2eName } from "./support/funding-officers";

// E2-S1 through the running app, signed in: create and list Prospects, and no DELETE (criterion 7, EC22).
// Every name carries the e2e marker, so global-setup.ts removes what earlier runs created.
test.describe("E2-S1 Prospects", () => {
  test("creates a Prospect, finds it in the list, fetches it, and DELETE answers 405", async ({ page }) => {
    await signInAsAdmin(page);
    const officer = await createFundingOfficer(page, e2eName("Rina Kartika"));
    const name = e2eName("SDN 3 Cibinong");

    const created = await page.request.post("/api/prospects", {
      headers: { "idempotency-key": crypto.randomUUID() },
      data: {
        name,
        category: "sekolah",
        fundingOfficerId: officer.id,
        location: { lat: -6.4817, lng: 106.854 },
        contact: { name: "Ibu Sri Wahyuni", role: "Kepala Sekolah", phone: "0812 3456 7890" },
        potentialAccounts: 350,
      },
    });
    expect(created.status()).toBe(201);
    const { prospect, duplicates } = (await created.json()) as {
      prospect: { id: string; name: string; contact: { phone: string } };
      duplicates: unknown[];
    };
    expect(prospect.name).toBe(name);
    expect(prospect.contact.phone).toBe("+6281234567890");
    expect(duplicates).toEqual([]);

    const listed = await page.request.get(
      `/api/prospects?q=${encodeURIComponent(name)}&fundingOfficerId=${officer.id}`,
    );
    expect(listed.status()).toBe(200);
    expect(listed.headers()["cache-control"]).toContain("no-store");
    const body = (await listed.json()) as { items: { id: string; hasLocation: boolean; openPipeline: null }[]; total: number };
    expect(body.total).toBe(1);
    expect(body.items[0]).toMatchObject({ id: prospect.id, hasLocation: true, openPipeline: null });

    expect((await page.request.get(`/api/prospects/${prospect.id}`)).status()).toBe(200);
    for (const path of ["/api/prospects", `/api/prospects/${prospect.id}`]) {
      expect((await page.request.delete(path)).status(), `DELETE ${path}`).toBe(405);
    }
    expect((await page.request.get(`/api/prospects/${prospect.id}`)).status()).toBe(200);
  });

  test("answers 401 when signed out", async ({ page }) => {
    expect((await page.request.get("/api/prospects")).status()).toBe(401);
  });
});
