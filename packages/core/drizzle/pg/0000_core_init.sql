CREATE TABLE "core_event_consumption" (
	"consumer_id" text NOT NULL,
	"event_id" text NOT NULL,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"updated_at" text NOT NULL,
	CONSTRAINT "core_event_consumption_consumer_id_event_id_pk" PRIMARY KEY("consumer_id","event_id")
);
--> statement-breakpoint
CREATE TABLE "core_event_log" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"version" integer NOT NULL,
	"guild_id" text NOT NULL,
	"source" text NOT NULL,
	"payload" text NOT NULL,
	"occurred_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core_kv" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core_scheduled_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"run_at" text NOT NULL,
	"payload" text NOT NULL,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"locked_until" text,
	"last_error" text,
	"dedupe_key" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "core_scheduled_jobs_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE INDEX "core_event_log_occurred_at_idx" ON "core_event_log" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "core_scheduled_jobs_due_idx" ON "core_scheduled_jobs" USING btree ("status","run_at");