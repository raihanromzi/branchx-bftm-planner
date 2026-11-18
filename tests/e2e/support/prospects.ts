import { expect, type Page } from "@playwright/test";
import { e2eName } from "./funding-officers";

// Synthetic Prospects for end-to-end tests, made through the real API. Every name ends with the e2e marker
// (support/funding-officers.ts), so global-setup.ts removes what earlier runs created.

/** The longest Prospect name (api.md, Prospects). */
export const PROSPECT_NAME_MAX = 150;

export type ProspectRecord = { id: string; name: string; version: number; archived: boolean };

type ProspectInput = {
  name: string;
  fundingOfficerId: string;
  category?: string | null;
  location?: { lat: number; lng: number } | null;
  potentialAccounts?: number | null;
};

export async function createProspect(page: Page, input: ProspectInput) {
  const response = await page.request.post("/api/prospects", {
    headers: { "idempotency-key": crypto.randomUUID() },
    data: input,
  });
  expect(response.status(), `create ${input.name}`).toBe(201);
  return ((await response.json()) as { prospect: ProspectRecord }).prospect;
}

export async function archiveProspect(page: Page, prospect: ProspectRecord) {
  const response = await page.request.post(`/api/prospects/${prospect.id}/archive`, {
    data: { version: prospect.version },
  });
  expect(response.status(), `archive ${prospect.name}`).toBe(200);
  return (await response.json()) as ProspectRecord;
}

/** A realistic name of exactly 150 characters (the longest allowed, EC7), ending with the e2e marker. */
export function e2eLongName() {
  const marker = e2eName(""); // " e2e-<id>"
  const base =
    "Paguyuban Pedagang Pasar Anyar Kota Bogor dan Koperasi Simpan Pinjam Karyawan Kantor Kecamatan Tanah Sareal Kelurahan Kebon Kalapa Wilayah Utara Blok C";
  return `${base.slice(0, PROSPECT_NAME_MAX - marker.length).trimEnd().padEnd(PROSPECT_NAME_MAX - marker.length, "a")}${marker}`;
}
