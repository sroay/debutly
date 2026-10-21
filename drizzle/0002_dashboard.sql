CREATE TABLE "screenshots" (
	"run_id" uuid NOT NULL,
	"key" text NOT NULL,
	"content_type" text NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "screenshots_run_id_key_pk" PRIMARY KEY("run_id","key")
);
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "app" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "trigger" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "ci_url" text;--> statement-breakpoint
ALTER TABLE "screenshots" ADD CONSTRAINT "screenshots_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "screenshots_created_at_idx" ON "screenshots" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "runs_app_created_at_idx" ON "runs" USING btree ("app","created_at" DESC NULLS LAST);