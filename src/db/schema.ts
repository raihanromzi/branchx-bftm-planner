// Drizzle schema. Backend stories add tables here, then run `npm run db:generate`.
// ADR 0001: no table or field may hold individual customer data
// (no account holder names, NIK, account numbers or balances).
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { PROSPECT_CATEGORIES } from "@/lib/validation";

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

/**
 * A member of the BFTM's team who does field acquisition (E1-S1). Does not sign in. Never deleted
 * (EC22): deactivated instead, after which no new work can be assigned to them. The phone is stored
 * normalised as "+62…" (E0-S6). Holds no customer data (ADR 0001).
 */
export const fundingOfficer = pgTable(
  "funding_officer",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    phone: text("phone").notNull(),
    active: boolean("active").notNull().default(true),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("funding_officer_active_name_idx").on(table.active, sql`lower(${table.name})`)],
);

/** A Prospect's Category (E2-S1). The UI labels are in PROSPECT_CATEGORY_LABELS. */
export const prospectCategory = pgEnum("prospect_category", PROSPECT_CATEGORIES);

/**
 * An institution or venue the team works to open accounts at (E2-S1). Never an account holder
 * (ADR 0001): the only person stored is one Contact Person (name, role, phone), and the only numbers
 * are account counts. Never deleted (EC22): archived instead (archived_at), and restorable.
 * name_key is the name trimmed, whitespace-collapsed and lower-cased (prospectNameKey), maintained by
 * the service; it drives the duplicate check (EC14), search and the sort by name.
 */
export const prospect = pgTable(
  "prospect",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    nameKey: text("name_key").notNull(),
    // Optional: only the name and the Funding Officer are required (docs/design/E2-S3.md).
    category: prospectCategory("category"),
    address: text("address"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    contactName: text("contact_name"),
    contactRole: text("contact_role"),
    contactPhone: text("contact_phone"),
    potentialAccounts: integer("potential_accounts"),
    fundingOfficerId: uuid("funding_officer_id")
      .notNull()
      .references(() => fundingOfficer.id, { onDelete: "restrict" }),
    note: text("note"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("prospect_name_key_idx").on(table.nameKey, table.id),
    index("prospect_name_key_trgm_idx").using("gin", sql`${table.nameKey} gin_trgm_ops`),
    index("prospect_funding_officer_id_idx").on(table.fundingOfficerId),
    index("prospect_archived_at_idx").on(table.archivedAt),
    check("prospect_name_length", sql`char_length(${table.name}) between 1 and 150`),
    check(
      "prospect_potential_accounts_range",
      sql`${table.potentialAccounts} is null or ${table.potentialAccounts} between 0 and 100000`,
    ),
    check("prospect_location_pair", sql`(${table.lat} is null) = (${table.lng} is null)`),
    check(
      "prospect_location_indonesia",
      sql`${table.lat} is null or (${table.lat} between -11 and 6 and ${table.lng} between 95 and 141)`,
    ),
  ],
);

/**
 * A reusable, ordered list of Stages, each with its Task checklist (E3-S1). A Pipeline is started
 * from one and copies its Stages and Tasks (E3-S3), so later edits never change running Pipelines
 * (EC21). Archived (archived_at) instead of deleted while a Pipeline uses it. name_key is the name
 * trimmed, whitespace-collapsed and lower-cased (pipelineTemplateNameKey); two active templates
 * cannot share it. Migration 0004 seeds the default template "Umum" into a fresh database.
 */
export const pipelineTemplate = pgTable(
  "pipeline_template",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    nameKey: text("name_key").notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("pipeline_template_active_name_key_idx").on(table.nameKey).where(sql`${table.archivedAt} is null`),
    check("pipeline_template_name_length", sql`char_length(${table.name}) between 1 and 100`),
  ],
);

/** One Stage of a Pipeline Template, at a 1-based position (E3-S1). Deleted with its template. */
export const templateStage = pgTable(
  "template_stage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => pipelineTemplate.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    name: text("name").notNull(),
  },
  (table) => [
    uniqueIndex("template_stage_template_id_position_idx").on(table.templateId, table.position),
    check("template_stage_position", sql`${table.position} >= 1`),
    check("template_stage_name_length", sql`char_length(${table.name}) between 1 and 60`),
  ],
);

/** One Task name of a template Stage, at a 1-based position (E3-S1). Deleted with its Stage. */
export const templateTask = pgTable(
  "template_task",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stageId: uuid("stage_id")
      .notNull()
      .references(() => templateStage.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    name: text("name").notNull(),
  },
  (table) => [
    uniqueIndex("template_task_stage_id_position_idx").on(table.stageId, table.position),
    check("template_task_position", sql`${table.position} >= 1`),
    check("template_task_name_length", sql`char_length(${table.name}) between 1 and 120`),
  ],
);
