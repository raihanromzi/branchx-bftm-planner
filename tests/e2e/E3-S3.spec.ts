import { expect, test, type Page } from "@playwright/test";
import { signInAsAdmin } from "./support/admin";
import { createFundingOfficer, e2eName } from "./support/funding-officers";
import { createProspect } from "./support/prospects";

// E3-S3 through the running app, signed in: start a Pipeline on the default template "Umum", move it, tick a
// Task, set Won, and reopen it. The Funding Officer and Prospect carry the e2e marker, so global-setup.ts
// removes them and their Pipelines on the next run.

type Pipeline = {
  id: string;
  outcome: string | null;
  accountsOpened: number | null;
  currentStagePosition: number;
  currentStage: { name: string };
  version: number;
  stages: { position: number; name: string; tasks: { id: string; name: string; done: boolean; version: number }[] }[];
};

/** The active default template "Umum" (migration 0004), or a fresh e2e template if a local run removed it. */
async function defaultTemplateId(page: Page): Promise<string> {
  const { items } = (await (await page.request.get("/api/pipeline-templates")).json()) as {
    items: { id: string; name: string; archived: boolean }[];
  };
  const umum = items.find((item) => item.name === "Umum" && !item.archived);
  if (umum) return umum.id;
  const created = await page.request.post("/api/pipeline-templates", {
    headers: { "idempotency-key": crypto.randomUUID() },
    data: { name: e2eName("Umum"), stages: [{ name: "Identifikasi", tasks: [{ name: "Kumpulkan data" }] }, { name: "Presentasi" }, { name: "Negosiasi" }] },
  });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { id: string }).id;
}

test.describe("E3-S3 Pipelines", () => {
  test("starts a Pipeline, moves it, ticks a Task, sets Won and reopens it", async ({ page }) => {
    await signInAsAdmin(page);
    const officer = await createFundingOfficer(page, e2eName("Rina Kartika"));
    const prospect = await createProspect(page, { name: e2eName("SDN 3 Cibinong"), fundingOfficerId: officer.id });
    const templateId = await defaultTemplateId(page);

    const started = await page.request.post("/api/pipelines", {
      headers: { "idempotency-key": crypto.randomUUID() },
      data: { prospectId: prospect.id, templateId },
    });
    expect(started.status()).toBe(201);
    let pipeline = (await started.json()) as Pipeline;
    expect(pipeline).toMatchObject({ outcome: null, currentStagePosition: 1, version: 1 });
    expect(pipeline.stages.length).toBeGreaterThanOrEqual(3);

    const second = await page.request.post("/api/pipelines", {
      headers: { "idempotency-key": crypto.randomUUID() },
      data: { prospectId: prospect.id, templateId },
    });
    expect(second.status()).toBe(409);
    expect((await second.json()).error.message).toBe("Prospect ini masih punya Pipeline yang berjalan.");

    const task = pipeline.stages[0].tasks[0];
    const ticked = await page.request.patch(`/api/pipeline-tasks/${task.id}`, { data: { done: true, version: task.version } });
    expect(ticked.status()).toBe(200);
    pipeline = (await ticked.json()) as Pipeline;
    expect(pipeline.stages[0].tasks[0].done).toBe(true);

    const moved = await page.request.post(`/api/pipelines/${pipeline.id}/move`, {
      data: { stagePosition: 3, version: pipeline.version },
    });
    expect(moved.status()).toBe(200);
    const move = (await moved.json()) as { pipeline: Pipeline; uncheckedTasksLeftBehind: number };
    const expectedLeft = pipeline.stages
      .filter((stage) => stage.position < 3)
      .flatMap((stage) => stage.tasks)
      .filter((item) => !item.done).length;
    expect(move.uncheckedTasksLeftBehind).toBe(expectedLeft);
    pipeline = move.pipeline;
    expect(pipeline.currentStagePosition).toBe(3);

    const listed = await page.request.get(`/api/prospects?fundingOfficerId=${officer.id}`);
    const rows = (await listed.json()) as { items: { id: string; openPipeline: { stagePosition: number; stageName: string } | null }[] };
    expect(rows.items.find((row) => row.id === prospect.id)?.openPipeline).toMatchObject({
      stagePosition: 3,
      stageName: pipeline.currentStage.name,
    });

    const won = await page.request.post(`/api/pipelines/${pipeline.id}/outcome`, {
      data: { outcome: "won", accountsOpened: 350, wonOn: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date()), version: pipeline.version },
    });
    expect(won.status()).toBe(200);
    pipeline = (await won.json()) as Pipeline;
    expect(pipeline).toMatchObject({ outcome: "won", accountsOpened: 350 });

    const reopened = await page.request.post(`/api/pipelines/${pipeline.id}/reopen`, { data: { version: pipeline.version } });
    expect(reopened.status()).toBe(200);
    expect(await reopened.json()).toMatchObject({ outcome: null, accountsOpened: null, wonOn: null, currentStagePosition: 3 });

    const history = await page.request.get(`/api/pipelines?prospectId=${prospect.id}`);
    expect(history.status()).toBe(200);
    expect(((await history.json()) as { items: { id: string }[] }).items.map((item) => item.id)).toEqual([pipeline.id]);
  });

  test("answers 401 when signed out", async ({ page }) => {
    expect((await page.request.get("/api/pipelines?prospectId=00000000-0000-4000-8000-000000000000")).status()).toBe(401);
  });
});
