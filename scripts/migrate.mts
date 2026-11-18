// Applies the Drizzle migrations in ./drizzle to DATABASE_URL.
// Used by `npm run db:migrate`, by CI, and by `vercel-build` when RUN_MIGRATIONS is "true".
import { existsSync } from "node:fs";
import nextEnv from "@next/env";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Add it to .env.local (see .env.example).");
  process.exit(1);
}

const migrationsFolder = "./drizzle";
if (!existsSync(`${migrationsFolder}/meta/_journal.json`)) {
  console.log("No migrations yet. Nothing to apply.");
  process.exit(0);
}

const client = postgres(url, { max: 1 });
try {
  await migrate(drizzle(client), { migrationsFolder });
  console.log("Migrations applied.");
} finally {
  await client.end();
}
