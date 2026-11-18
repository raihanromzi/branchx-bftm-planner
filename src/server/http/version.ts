// Optimistic concurrency for updates (ADR 0003, E0-S6 criterion 5).
import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { AnyPgColumn, PgTable, PgUpdateSetSource } from "drizzle-orm/pg-core";
import { type Db, type Tx, getDb } from "@/server/db";
import { notFound, versionConflict } from "./errors";

/** A table the Admin edits: it has id, version and (usually) updated_at columns. */
export type VersionedTable = PgTable & { id: AnyPgColumn; version: AnyPgColumn; updatedAt?: AnyPgColumn };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * UPDATE … SET …, version = version + 1, updated_at = now() WHERE id = $id AND version = $version.
 * Returns the updated row. Zero rows means 404 when the id does not exist, or 409 with the
 * "Data ini sudah diubah…" message when it exists with another version.
 */
export async function updateWithVersion<T extends VersionedTable>(
  table: T,
  id: string,
  version: number,
  set: PgUpdateSetSource<T>,
  { db = getDb() }: { db?: Db | Tx } = {},
): Promise<T["$inferSelect"]> {
  if (!UUID.test(id)) throw notFound();
  const values = {
    ...set,
    version: sql`${table.version} + 1`,
    ...(table.updatedAt ? { updatedAt: sql`now()` } : {}),
  } as PgUpdateSetSource<T>;
  const rows = (await db
    .update(table as PgTable)
    .set(values as PgUpdateSetSource<PgTable>)
    .where(and(eq(table.id, id), eq(table.version, version)))
    .returning()) as T["$inferSelect"][];
  if (rows.length === 1) return rows[0];

  const exists = await db
    .select({ id: table.id })
    .from(table as PgTable)
    .where(eq(table.id, id));
  throw exists.length > 0 ? versionConflict() : notFound();
}
