CREATE TYPE "public"."activity_status" AS ENUM('scheduled', 'done', 'cancelled');--> statement-breakpoint
CREATE TABLE "activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prospect_id" uuid NOT NULL,
	"funding_officer_id" uuid NOT NULL,
	"pipeline_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"purpose" text NOT NULL,
	"status" "activity_status" DEFAULT 'scheduled' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_purpose_length" CHECK (char_length("activity"."purpose") between 1 and 500)
);
--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_prospect_id_prospect_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospect"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_funding_officer_id_funding_officer_id_fk" FOREIGN KEY ("funding_officer_id") REFERENCES "public"."funding_officer"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_pipeline_id_pipeline_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipeline"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_starts_at_idx" ON "activity" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "activity_funding_officer_id_starts_at_idx" ON "activity" USING btree ("funding_officer_id","starts_at");--> statement-breakpoint
CREATE INDEX "activity_prospect_id_starts_at_idx" ON "activity" USING btree ("prospect_id","starts_at");--> statement-breakpoint
CREATE INDEX "activity_pipeline_id_idx" ON "activity" USING btree ("pipeline_id");