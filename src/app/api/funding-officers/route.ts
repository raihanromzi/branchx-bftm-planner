import { requireAdmin } from "@/server/auth";
import {
  CREATE_SCOPE,
  createFundingOfficer,
  createFundingOfficerInput,
  getFundingOfficer,
  listFundingOfficers,
} from "@/server/funding-officers";
import { assertSameOrigin, parseJson, readIdempotencyKey, toErrorResponse, withIdempotency } from "@/server/http";

const NO_STORE = { "Cache-Control": "no-store" };

/** Every Funding Officer: active first, then inactive, each by name (E1-S1 criterion 2). */
export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    return Response.json({ items: await listFundingOfficers() }, { headers: NO_STORE });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** Adds an active Funding Officer. 201 on create; 200 with the same record on a repeat of the key. */
export async function POST(request: Request) {
  try {
    await requireAdmin(request);
    assertSameOrigin(request);
    const key = readIdempotencyKey(request);
    const input = await parseJson(request, createFundingOfficerInput);
    const { id, created } = await withIdempotency(CREATE_SCOPE, key, (tx) => createFundingOfficer(input, { db: tx }));
    return Response.json(await getFundingOfficer(id), { status: created ? 201 : 200, headers: NO_STORE });
  } catch (error) {
    return toErrorResponse(error);
  }
}
