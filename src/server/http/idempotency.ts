// Idempotent creates (ADR 0003, E0-S6 criterion 4).
import "server-only";
import { eq, lt, sql } from "drizzle-orm";
import { idempotencyKey } from "@/db/schema";
import { type Db, type Tx, getDb } from "@/server/db";
import { ApiError } from "./errors";

export const IDEMPOTENCY_HEADER = "Idempotency-Key";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The Idempotency-Key header of a create, lower-cased. Throws 400 when it is missing or not a UUID. */
export function readIdempotencyKey(request: Request): string {
  const key = request.headers.get(IDEMPOTENCY_HEADER)?.trim() ?? "";
  if (!UUID.test(key)) {
    throw new ApiError(
      400,
      "idempotency_key",
      key ? "Header Idempotency-Key harus berupa UUID." : "Header Idempotency-Key wajib ada.",
    );
  }
  return key.toLowerCase();
}

export type IdempotentResult = { id: string; created: boolean };

/**
 * Runs `create` at most once per key. `create` makes the record inside the given transaction and
 * returns its id. A repeat with the same key returns that id with created: false and does not run
 * `create` again.
 *
 * Concurrency: the key row is inserted first, with ON CONFLICT DO NOTHING, in the same transaction
 * as the create. A second request with the same key blocks on that insert (the primary key) until
 * the first commits, then finds the committed row and returns its result_id. If the first create
 * fails, its transaction rolls back with the key, so the waiting or a later request creates instead.
 *
 * Keys expire after 24 hours: expired rows are purged before each use. A key already used for a
 * different scope is refused with 422 "idempotency_key_reused".
 */
export async function withIdempotency(
  scope: string,
  key: string,
  create: (tx: Tx) => Promise<string>,
  { db = getDb() }: { db?: Db } = {},
): Promise<IdempotentResult> {
  await db.delete(idempotencyKey).where(lt(idempotencyKey.createdAt, sql`now() - interval '24 hours'`));

  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(idempotencyKey)
      .values({ key, scope })
      .onConflictDoNothing({ target: idempotencyKey.key })
      .returning({ key: idempotencyKey.key });

    if (inserted.length === 1) {
      const id = await create(tx);
      await tx.update(idempotencyKey).set({ resultId: id }).where(eq(idempotencyKey.key, key));
      return { id, created: true };
    }

    const [existing] = await tx.select().from(idempotencyKey).where(eq(idempotencyKey.key, key));
    if (existing && existing.scope !== scope) {
      throw new ApiError(422, "idempotency_key_reused", "Idempotency-Key ini sudah dipakai untuk permintaan lain.");
    }
    if (!existing?.resultId) {
      // Only possible if the row was purged or is mid-write in a way we cannot see; ask for a retry.
      throw new ApiError(409, "idempotency_key_pending", "Permintaan yang sama sedang diproses. Coba lagi.");
    }
    return { id: existing.resultId, created: false };
  });
}
