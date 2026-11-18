import { expect, type Page } from "@playwright/test";

// Synthetic Funding Officers for end-to-end tests. Every name ends with a unique " e2e-<id>" marker, so
// parallel tests never see each other's rows and global-setup.ts can remove what earlier runs created.

/** Matches the marker at the end of a name (a Postgres regular expression too). */
export const E2E_NAME_PATTERN = " e2e-[a-z0-9]+$";

export function e2eName(base: string) {
  return `${base} e2e-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export type FundingOfficerRecord = {
  id: string;
  name: string;
  phone: string;
  active: boolean;
  version: number;
};

/** Adds a Funding Officer through the real API, as the signed-in page's context. */
export async function createFundingOfficer(page: Page, name: string, phone = "0812 3456 7890") {
  const response = await page.request.post("/api/funding-officers", {
    headers: { "idempotency-key": crypto.randomUUID() },
    data: { name, phone },
  });
  expect(response.status(), `create ${name}`).toBe(201);
  return (await response.json()) as FundingOfficerRecord;
}

export async function deactivateFundingOfficer(page: Page, officer: FundingOfficerRecord) {
  const response = await page.request.post(`/api/funding-officers/${officer.id}/deactivate`, {
    data: { version: officer.version },
  });
  expect(response.status(), `deactivate ${officer.name}`).toBe(200);
  return (await response.json()) as FundingOfficerRecord;
}
