CREATE TABLE "sentinel_combat_rounds" (
	"combat_id" text NOT NULL,
	"round" integer NOT NULL,
	"actions" text NOT NULL,
	"idle" integer DEFAULT 0 NOT NULL,
	"log" text NOT NULL,
	"resolved_at" text NOT NULL,
	CONSTRAINT "sentinel_combat_rounds_combat_id_round_pk" PRIMARY KEY("combat_id","round")
);
--> statement-breakpoint
CREATE TABLE "sentinel_combatants" (
	"id" text NOT NULL,
	"combat_id" text NOT NULL,
	"side" text NOT NULL,
	"kind" text NOT NULL,
	"ref_id" text NOT NULL,
	"name" text NOT NULL,
	"archetype" text,
	"level" integer NOT NULL,
	"max_hp" integer NOT NULL,
	"hp" integer NOT NULL,
	"atk" integer NOT NULL,
	"def" integer NOT NULL,
	"spd" integer NOT NULL,
	"foc" integer NOT NULL,
	"power_cooldown_max" integer NOT NULL,
	"power_cooldown" integer NOT NULL,
	"start_power_cooldown" integer NOT NULL,
	"downed_at_round" integer,
	CONSTRAINT "sentinel_combatants_combat_id_id_pk" PRIMARY KEY("combat_id","id")
);
--> statement-breakpoint
CREATE TABLE "sentinel_combats" (
	"id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"requested_by" text NOT NULL,
	"mode" text NOT NULL,
	"mission_id" text,
	"raid_id" text,
	"channel_id" text NOT NULL,
	"thread_id" text,
	"prompt_message_id" text,
	"seed" bigint NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"round" integer DEFAULT 0 NOT NULL,
	"max_rounds" integer NOT NULL,
	"winner_side" text,
	"log_hash" text,
	"created_at" text NOT NULL,
	"finished_at" text
);
--> statement-breakpoint
CREATE TABLE "sentinel_pending_actions" (
	"combat_id" text NOT NULL,
	"round" integer NOT NULL,
	"combatant_id" text NOT NULL,
	"action" text NOT NULL,
	"chosen_at" text NOT NULL,
	CONSTRAINT "sentinel_pending_actions_combat_id_round_combatant_id_pk" PRIMARY KEY("combat_id","round","combatant_id")
);
--> statement-breakpoint
CREATE INDEX "sentinel_combatants_ref_idx" ON "sentinel_combatants" USING btree ("ref_id");--> statement-breakpoint
CREATE INDEX "sentinel_combats_status_idx" ON "sentinel_combats" USING btree ("status");