CREATE TABLE "pipeline_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pipeline_template_name_length" CHECK (char_length("pipeline_template"."name") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "template_stage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "template_stage_position" CHECK ("template_stage"."position" >= 1),
	CONSTRAINT "template_stage_name_length" CHECK (char_length("template_stage"."name") between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE "template_task" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stage_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "template_task_position" CHECK ("template_task"."position" >= 1),
	CONSTRAINT "template_task_name_length" CHECK (char_length("template_task"."name") between 1 and 120)
);
--> statement-breakpoint
ALTER TABLE "template_stage" ADD CONSTRAINT "template_stage_template_id_pipeline_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."pipeline_template"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_task" ADD CONSTRAINT "template_task_stage_id_template_stage_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."template_stage"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_template_active_name_key_idx" ON "pipeline_template" USING btree ("name_key") WHERE "pipeline_template"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "template_stage_template_id_position_idx" ON "template_stage" USING btree ("template_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "template_task_stage_id_position_idx" ON "template_task" USING btree ("stage_id","position");--> statement-breakpoint
-- seed:default-template:start
-- The default Pipeline Template (E3-S1 criterion 2), hand-written: "Umum" with five Stages and their
-- starter Tasks (PRD open question 4, approved 2026-11-18). It is inserted only when
-- no template exists, so it is safe to run again; the migrator runs it once per database anyway.
WITH new_template AS (
	INSERT INTO "pipeline_template" ("name", "name_key")
	SELECT 'Umum', 'umum'
	WHERE NOT EXISTS (SELECT 1 FROM "pipeline_template")
	RETURNING "id"
), new_stage AS (
	INSERT INTO "template_stage" ("template_id", "position", "name")
	SELECT new_template."id", stage."position", stage."name"
	FROM new_template,
		(VALUES
			(1, 'Identifikasi'),
			(2, 'Pendekatan'),
			(3, 'Presentasi'),
			(4, 'Negosiasi'),
			(5, 'Pembukaan Rekening')
		) AS stage ("position", "name")
	RETURNING "id", "position"
)
INSERT INTO "template_task" ("stage_id", "position", "name")
SELECT new_stage."id", task."position", task."name"
FROM new_stage
JOIN (VALUES
	(1, 1, 'Kumpulkan data Prospect'),
	(1, 2, 'Tentukan Kontak'),
	(2, 1, 'Hubungi Kontak'),
	(2, 2, 'Jadwalkan kunjungan pertama'),
	(3, 1, 'Siapkan materi'),
	(3, 2, 'Presentasi ke pengambil keputusan'),
	(3, 3, 'Kirim proposal'),
	(4, 1, 'Bahas jumlah rekening'),
	(4, 2, 'Sepakati jadwal pembukaan'),
	(5, 1, 'Siapkan formulir'),
	(5, 2, 'Kumpulkan dokumen pendukung')
) AS task ("stage_position", "position", "name") ON task."stage_position" = new_stage."position";
-- seed:default-template:end
