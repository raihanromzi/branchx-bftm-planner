// Drizzle schema. Backend stories add tables here, then run `npm run db:generate`.
// ADR 0001: no table or field may hold individual customer data
// (no account holder names, NIK, account numbers or balances).
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Idempotency-Key values sent with create requests (ADR 0003), so a retried create returns
 * the record it already made instead of a duplicate. Rows are purged after 24 hours.
 */
export const idempotencyKey = pgTable(
  "idempotency_key",
  {
    key: uuid("key").primaryKey(),
    // Which create the key was used for, such as "prospect.create".
    scope: text("scope").notNull(),
    // ID of the record the create made; null until it has been made.
    resultId: uuid("result_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idempotency_key_created_at_idx").on(table.createdAt)],
);
