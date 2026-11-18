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

/**
 * The Admin who signs in (ADR 0002). Created or updated only by `npm run admin:seed`; there is no
 * sign-up. The email is stored trimmed and lower-cased. The password is stored only as a scrypt hash.
 */
export const admin = pgTable("admin", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A signed-in browser (ADR 0002). The cookie holds a random token; only its SHA-256 hash is kept here,
 * so a database leak does not hand out working sessions. Sign-out deletes the row.
 */
export const session = pgTable(
  "session",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adminId: uuid("admin_id")
      .notNull()
      .references(() => admin.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("session_admin_id_idx").on(table.adminId), index("session_expires_at_idx").on(table.expiresAt)],
);

/**
 * A failed sign-in, for the lockout (ADR 0002, EC41): 5 failures for an email in 15 minutes refuse
 * further attempts. The email is normalised and need not belong to an Admin. A success deletes the
 * email's rows.
 */
export const signInAttempt = pgTable(
  "sign_in_attempt",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("sign_in_attempt_email_attempted_at_idx").on(table.email, table.attemptedAt)],
);
