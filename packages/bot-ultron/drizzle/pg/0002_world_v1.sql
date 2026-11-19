CREATE TABLE "ultron_event_waves" (
	"world_event_id" text NOT NULL,
	"wave" integer NOT NULL,
	"max_hp" integer NOT NULL,
	"boss_level" integer NOT NULL,
	"started_at" text NOT NULL,
	"ended_at" text,
	"outcome" text,
	CONSTRAINT "ultron_event_waves_world_event_id_wave_pk" PRIMARY KEY("world_event_id","wave")
);
--> statement-breakpoint
CREATE TABLE "ultron_threat" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"level" integer DEFAULT 0 NOT NULL,
	"last_tick_day" text,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ultron_war_points" (
	"id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"war_id" text NOT NULL,
	"member_id" text NOT NULL,
	"faction" text NOT NULL,
	"points" integer NOT NULL,
	"reason" text NOT NULL,
	"source_key" text NOT NULL,
	"created_by" text,
	"note" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ultron_wars" (
	"id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"status" text NOT NULL,
	"starts_at" text NOT NULL,
	"ends_at" text NOT NULL,
	"winners" text,
	"result_message_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ultron_strikes" ADD COLUMN "wave" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "ultron_world_events" ADD COLUMN "waves" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "ultron_world_events" ADD COLUMN "wave" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ultron_war_points_source_uq" ON "ultron_war_points" USING btree ("source_key");--> statement-breakpoint
CREATE INDEX "ultron_war_points_faction_idx" ON "ultron_war_points" USING btree ("war_id","faction");--> statement-breakpoint
CREATE INDEX "ultron_war_points_member_idx" ON "ultron_war_points" USING btree ("war_id","member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ultron_wars_start_uq" ON "ultron_wars" USING btree ("guild_id","starts_at");--> statement-breakpoint
CREATE INDEX "ultron_wars_status_idx" ON "ultron_wars" USING btree ("status");