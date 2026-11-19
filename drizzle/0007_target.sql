CREATE TABLE "target" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"funding_officer_id" uuid NOT NULL,
	"month" date NOT NULL,
	"accounts" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "target_accounts_range" CHECK ("target"."accounts" between 0 and 100000),
	CONSTRAINT "target_month_first_day" CHECK (extract(day from "target"."month") = 1)
);
--> statement-breakpoint
ALTER TABLE "target" ADD CONSTRAINT "target_funding_officer_id_funding_officer_id_fk" FOREIGN KEY ("funding_officer_id") REFERENCES "public"."funding_officer"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "target_funding_officer_id_month_idx" ON "target" USING btree ("funding_officer_id","month");--> statement-breakpoint
CREATE INDEX "target_month_idx" ON "target" USING btree ("month");