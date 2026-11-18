// Playwright global setup: seeds the e2e Admin into the database the dev server uses.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadEnvConfig } from "@next/env";
import postgres from "postgres";
import { E2E_ADMIN } from "./admin";

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
  } finally {
    await sql.end();
  }
}
