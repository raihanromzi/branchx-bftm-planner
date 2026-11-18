import { connection } from "next/server";
import { healthResponse } from "@/server/health";

// Public: no Admin session needed (E0-S3 criterion 5 exempts it).
export async function GET() {
  // Run at request time, never prerendered at build.
  await connection();
  return healthResponse();
}
