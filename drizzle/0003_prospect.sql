-- pg_trgm backs the search index on name_key (available on Postgres 16 and on Neon).
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TYPE "public"."prospect_category" AS ENUM('sekolah', 'pasar', 'perusahaan', 'instansi', 'komunitas', 'lainnya');--> statement-breakpoint
CREATE TABLE "prospect" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"category" "prospect_category",
	"address" text,
	"lat" double precision,
	"lng" double precision,
	"contact_name" text,
	"contact_role" text,
	"contact_phone" text,
	"potential_accounts" integer,
	"funding_officer_id" uuid NOT NULL,
	"note" text,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prospect_name_length" CHECK (char_length("prospect"."name") between 1 and 150),
	CONSTRAINT "prospect_potential_accounts_range" CHECK ("prospect"."potential_accounts" is null or "prospect"."potential_accounts" between 0 and 100000),
	CONSTRAINT "prospect_location_pair" CHECK (("prospect"."lat" is null) = ("prospect"."lng" is null)),
	CONSTRAINT "prospect_location_indonesia" CHECK ("prospect"."lat" is null or ("prospect"."lat" between -11 and 6 and "prospect"."lng" between 95 and 141))
);
--> statement-breakpoint
ALTER TABLE "prospect" ADD CONSTRAINT "prospect_funding_officer_id_funding_officer_id_fk" FOREIGN KEY ("funding_officer_id") REFERENCES "public"."funding_officer"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prospect_name_key_idx" ON "prospect" USING btree ("name_key","id");--> statement-breakpoint
CREATE INDEX "prospect_name_key_trgm_idx" ON "prospect" USING gin ("name_key" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "prospect_funding_officer_id_idx" ON "prospect" USING btree ("funding_officer_id");--> statement-breakpoint
CREATE INDEX "prospect_archived_at_idx" ON "prospect" USING btree ("archived_at");