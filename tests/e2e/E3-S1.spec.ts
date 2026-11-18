import { expect, test } from "@playwright/test";
import { signInAsAdmin } from "./support/admin";
import { e2eName } from "./support/funding-officers";

// E3-S1 through the running app, signed in: create a Pipeline Template, read it back, delete it (unused).
// Every name carries the e2e marker, so global-setup.ts removes what an interrupted run left behind.
test.describe("E3-S1 Pipeline Templates", () => {
  test("creates a template with ordered Stages and Tasks, fetches it, lists it, and deletes it with 204", async ({ page }) => {
    await signInAsAdmin(page);
    const name = e2eName("Sekolah");

    const created = await page.request.post("/api/pipeline-templates", {
      headers: { "idempotency-key": crypto.randomUUID() },
      data: {
        name,
        stages: [
          { name: "Identifikasi", tasks: [{ name: "Kumpulkan data Prospect" }, { name: "Tentukan Kontak" }] },
          { name: "Presentasi", tasks: [] },
        ],
      },
    });
    expect(created.status()).toBe(201);
    const template = (await created.json()) as { id: string; name: string; stages: { name: string; position: number; tasks: { name: string }[] }[] };
    expect(template.name).toBe(name);
    expect(template.stages.map((stage) => [stage.position, stage.name, stage.tasks.map((task) => task.name)])).toEqual([
      [1, "Identifikasi", ["Kumpulkan data Prospect", "Tentukan Kontak"]],
      [2, "Presentasi", []],
    ]);

    const fetched = await page.request.get(`/api/pipeline-templates/${template.id}`);
    expect(fetched.status()).toBe(200);
    expect(await fetched.json()).toEqual(template);

    const listed = await page.request.get("/api/pipeline-templates");
    expect(listed.status()).toBe(200);
    expect(listed.headers()["cache-control"]).toContain("no-store");
    const { items } = (await listed.json()) as { items: { id: string; stageCount: number; pipelineCount: number }[] };
    expect(items.find((item) => item.id === template.id)).toMatchObject({ stageCount: 2, pipelineCount: 0 });

    const deleted = await page.request.delete(`/api/pipeline-templates/${template.id}`);
    expect(deleted.status()).toBe(204);
    expect((await page.request.get(`/api/pipeline-templates/${template.id}`)).status()).toBe(404);
  });

  test("answers 401 when signed out", async ({ page }) => {
    expect((await page.request.get("/api/pipeline-templates")).status()).toBe(401);
  });
});
