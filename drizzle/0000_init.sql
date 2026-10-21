CREATE TABLE "agents" (
	"run_id" uuid NOT NULL,
	"id" text NOT NULL,
	"unit_id" text NOT NULL,
	"name" text NOT NULL,
	"role" text,
	"inclusion" text,
	"persona" jsonb NOT NULL,
	CONSTRAINT "agents_run_id_id_pk" PRIMARY KEY("run_id","id")
);
--> statement-breakpoint
CREATE TABLE "customer_units" (
	"run_id" uuid NOT NULL,
	"id" text NOT NULL,
	"kind" text NOT NULL,
	"business" jsonb,
	CONSTRAINT "customer_units_run_id_id_pk" PRIMARY KEY("run_id","id")
);
--> statement-breakpoint
CREATE TABLE "findings" (
	"run_id" uuid NOT NULL,
	"signature" text NOT NULL,
	"kind" text NOT NULL,
	"severity" text NOT NULL,
	"confidence" text NOT NULL,
	"title" text NOT NULL,
	"detail" text NOT NULL,
	"page_path" text NOT NULL,
	"hit_by" text[] NOT NULL,
	"visitors" integer NOT NULL,
	"evidence" jsonb NOT NULL,
	"sandbox_cause" text[],
	CONSTRAINT "findings_run_id_signature_pk" PRIMARY KEY("run_id","signature")
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_url" text NOT NULL,
	"goal" text NOT NULL,
	"icp" text,
	"tier" text,
	"unit_kind" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"model" text,
	"estimate_low_usd" double precision,
	"estimate_high_usd" double precision,
	"cost_usd" double precision,
	"input_tokens" integer,
	"output_tokens" integer,
	"report_md" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"run_id" uuid NOT NULL,
	"agent_id" text NOT NULL,
	"goal" text NOT NULL,
	"outcome" text,
	"outcome_note" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd" double precision,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "sessions_run_id_agent_id_pk" PRIMARY KEY("run_id","agent_id")
);
--> statement-breakpoint
CREATE TABLE "side_effects" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "side_effects_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"run_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"rule" text,
	"channel" text NOT NULL,
	"host" text NOT NULL,
	"url" text NOT NULL,
	"recipient" text,
	"summary" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "steps" (
	"run_id" uuid NOT NULL,
	"agent_id" text NOT NULL,
	"index" integer NOT NULL,
	"url" text NOT NULL,
	"title" text,
	"action" jsonb NOT NULL,
	"reasoning" text,
	"observation" jsonb NOT NULL,
	"signals" jsonb NOT NULL,
	"error" text,
	"blocked" text,
	"screenshot_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "steps_run_id_agent_id_index_pk" PRIMARY KEY("run_id","agent_id","index")
);
--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_units" ADD CONSTRAINT "customer_units_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "side_effects" ADD CONSTRAINT "side_effects_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "steps" ADD CONSTRAINT "steps_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "runs_created_at_idx" ON "runs" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "side_effects_run_idx" ON "side_effects" USING btree ("run_id");