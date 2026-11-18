CREATE TYPE "public"."pipeline_outcome" AS ENUM('won', 'lost', 'on_hold');--> statement-breakpoint
CREATE TABLE "pipeline" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prospect_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"funding_officer_id" uuid NOT NULL,
	"current_stage_position" integer DEFAULT 1 NOT NULL,
	"outcome" "pipeline_outcome",
	"accounts_opened" integer,
	"won_on" date,
	"lost_reason" text,
	"closed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pipeline_current_stage_position" CHECK ("pipeline"."current_stage_position" >= 1),
	CONSTRAINT "pipeline_accounts_opened_range" CHECK ("pipeline"."accounts_opened" is null or "pipeline"."accounts_opened" between 1 and 100000),
	CONSTRAINT "pipeline_won_fields" CHECK (("pipeline"."outcome" is not distinct from 'won') = ("pipeline"."accounts_opened" is not null)
        and ("pipeline"."outcome" is not distinct from 'won') = ("pipeline"."won_on" is not null)),
	CONSTRAINT "pipeline_lost_fields" CHECK (("pipeline"."outcome" is not distinct from 'lost') = ("pipeline"."lost_reason" is not null)),
	CONSTRAINT "pipeline_closed_at" CHECK (coalesce("pipeline"."outcome" in ('won', 'lost'), false) = ("pipeline"."closed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "pipeline_stage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "pipeline_stage_position" CHECK ("pipeline_stage"."position" >= 1),
	CONSTRAINT "pipeline_stage_name_length" CHECK (char_length("pipeline_stage"."name") between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE "pipeline_task" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stage_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"due_on" date,
	"done_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pipeline_task_position" CHECK ("pipeline_task"."position" >= 1),
	CONSTRAINT "pipeline_task_name_length" CHECK (char_length("pipeline_task"."name") between 1 and 120)
);
--> statement-breakpoint
ALTER TABLE "pipeline" ADD CONSTRAINT "pipeline_prospect_id_prospect_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospect"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline" ADD CONSTRAINT "pipeline_template_id_pipeline_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."pipeline_template"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline" ADD CONSTRAINT "pipeline_funding_officer_id_funding_officer_id_fk" FOREIGN KEY ("funding_officer_id") REFERENCES "public"."funding_officer"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_stage" ADD CONSTRAINT "pipeline_stage_pipeline_id_pipeline_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipeline"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_task" ADD CONSTRAINT "pipeline_task_stage_id_pipeline_stage_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."pipeline_stage"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_one_open_per_prospect_idx" ON "pipeline" USING btree ("prospect_id") WHERE "pipeline"."outcome" is null or "pipeline"."outcome" = 'on_hold';--> statement-breakpoint
CREATE INDEX "pipeline_prospect_id_started_at_idx" ON "pipeline" USING btree ("prospect_id","started_at");--> statement-breakpoint
CREATE INDEX "pipeline_template_id_idx" ON "pipeline" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "pipeline_funding_officer_id_idx" ON "pipeline" USING btree ("funding_officer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_stage_pipeline_id_position_idx" ON "pipeline_stage" USING btree ("pipeline_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_task_stage_id_position_idx" ON "pipeline_task" USING btree ("stage_id","position");