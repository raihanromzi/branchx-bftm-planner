CREATE TABLE "idempotency_key" (
	"key" uuid PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"result_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idempotency_key_created_at_idx" ON "idempotency_key" USING btree ("created_at");