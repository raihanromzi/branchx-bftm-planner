// Playwright global setup: seeds the e2e Admin into the database the dev server uses.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadEnvConfig } from "@next/env";
import postgres from "postgres";
import { E2E_ADMIN } from "./admin";
import { E2E_NAME_PATTERN } from "./funding-officers";

const run = promisify(execFile);

export default async function globalSetup() {
  // Read DATABASE_URL the way `next dev` does: the environment first, then .env.development.local,
  // .env.local, .env.development and .env.
  loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set: the e2e tests need the dev server's database (ADR 0005).");
  const host = new URL(url).hostname.toLowerCase();
  if (host === "neon.tech" || host.endsWith(".neon.tech")) {
    throw new Error("Refusing to seed the e2e Admin into a neon.tech database. Point DATABASE_URL at local Postgres (ADR 0005).");
  }

  await run("node", ["scripts/seed-admin.mts", E2E_ADMIN.email], {
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: "test",
      DATABASE_URL: url,
      DATABASE_URL_UNPOOLED: url,
      ADMIN_PASSWORD: E2E_ADMIN.password,
    },
  });

  // Start without leftover failures, so an earlier run cannot leave the e2e Admin locked out.
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  try {
    await sql`delete from sign_in_attempt where email = ${E2E_ADMIN.email}`;
    // Activities (E4-S1, created by the E2-S4 tests) go before everything: they point to a Prospect, a
    // Funding Officer and a Pipeline with restrict. Removed: Activities of e2e Prospects or Funding Officers.
    await sql`
      delete from activity
      where prospect_id in (select id from prospect where name ~ ${E2E_NAME_PATTERN})
         or funding_officer_id in (select id from funding_officer where name ~ ${E2E_NAME_PATTERN})
         or prospect_id in (
              select id from prospect
              where funding_officer_id in (select id from funding_officer where name ~ ${E2E_NAME_PATTERN}))
         or pipeline_id in (
              select id from pipeline
              where prospect_id in (
                      select id from prospect
                      where name ~ ${E2E_NAME_PATTERN}
                         or funding_officer_id in (select id from funding_officer where name ~ ${E2E_NAME_PATTERN}))
                 or funding_officer_id in (select id from funding_officer where name ~ ${E2E_NAME_PATTERN})
                 or template_id in (select id from pipeline_template where name ~ ${E2E_NAME_PATTERN}))`;
    // Pipelines (E3-S3) go first, with their Stages and Tasks (cascade): a Prospect, Funding Officer or
    // template cannot be deleted while a Pipeline points to it (restrict). Removed: Pipelines of e2e
    // Prospects, of e2e Funding Officers, or started from e2e templates.
    await sql`
      delete from pipeline
      where prospect_id in (
              select id from prospect
              where name ~ ${E2E_NAME_PATTERN}
                 or funding_officer_id in (select id from funding_officer where name ~ ${E2E_NAME_PATTERN}))
         or funding_officer_id in (select id from funding_officer where name ~ ${E2E_NAME_PATTERN})
         or template_id in (select id from pipeline_template where name ~ ${E2E_NAME_PATTERN})`;
    // Prospects go next: a Funding Officer cannot be deleted while a Prospect points to it (restrict).
    // Removed: Prospects with the marker, and any Prospect assigned to a marked (e2e) Funding Officer.
    await sql`
      delete from prospect
      where name ~ ${E2E_NAME_PATTERN}
         or funding_officer_id in (select id from funding_officer where name ~ ${E2E_NAME_PATTERN})`;
    // Funding Officers that earlier e2e runs created, and only those: every one has the e2e marker at the
    // end of its name (support/funding-officers.ts). The API never deletes a Funding Officer (EC22), so
    // without this they pile up in the dev database until the list's 200-row cap hides new ones.
    await sql`delete from funding_officer where name ~ ${E2E_NAME_PATTERN}`;
    // Pipeline Templates that e2e runs created (E3-S1); their Stages and Tasks go with them (cascade).
    // Their Pipelines were deleted above.
    await sql`delete from pipeline_template where name ~ ${E2E_NAME_PATTERN}`;
  } finally {
    await sql.end();
  }
}
