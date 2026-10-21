CREATE TABLE "predictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"metric" text NOT NULL,
	"claim" text NOT NULL,
	"predicted" jsonb NOT NULL,
	"actual" jsonb,
	"correct" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "predictions_run_idx" ON "predictions" USING btree ("run_id");