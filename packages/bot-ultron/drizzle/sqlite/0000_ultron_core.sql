CREATE TABLE `ultron_encounters` (
	`id` text PRIMARY KEY NOT NULL,
	`guild_id` text NOT NULL,
	`mission_id` text,
	`combat_id` text NOT NULL,
	`seed` integer NOT NULL,
	`party_level` integer NOT NULL,
	`party_size` integer NOT NULL,
	`difficulty` text NOT NULL,
	`adaptive_multiplier` real NOT NULL,
	`enemies` text NOT NULL,
	`outcome` text,
	`requested_by_user_id` text,
	`created_at` text NOT NULL,
	`resolved_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ultron_encounters_mission_uq` ON `ultron_encounters` (`mission_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ultron_encounters_combat_uq` ON `ultron_encounters` (`combat_id`);--> statement-breakpoint
CREATE TABLE `ultron_enemy_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`tier` text NOT NULL,
	`min_level` integer NOT NULL,
	`base` text NOT NULL,
	`power_cooldown_max` integer NOT NULL,
	`taunt_keys` text NOT NULL,
	`content_hash` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ultron_event_participants` (
	`world_event_id` text NOT NULL,
	`member_id` text NOT NULL,
	`faction` text,
	`damage` integer DEFAULT 0 NOT NULL,
	`strikes` integer DEFAULT 0 NOT NULL,
	`knockouts` integer DEFAULT 0 NOT NULL,
	`next_strike_at` text NOT NULL,
	`joined_at` text NOT NULL,
	PRIMARY KEY(`world_event_id`, `member_id`)
);
--> statement-breakpoint
CREATE TABLE `ultron_faction_damage` (
	`world_event_id` text NOT NULL,
	`faction` text NOT NULL,
	`damage` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`world_event_id`, `faction`)
);
--> statement-breakpoint
CREATE TABLE `ultron_flavor_log` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`provider` text NOT NULL,
	`ok` integer NOT NULL,
	`latency_ms` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ultron_flavor_log_created_idx` ON `ultron_flavor_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `ultron_strikes` (
	`combat_id` text PRIMARY KEY NOT NULL,
	`world_event_id` text NOT NULL,
	`member_id` text NOT NULL,
	`damage` integer,
	`applied_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ultron_strikes_event_idx` ON `ultron_strikes` (`world_event_id`);--> statement-breakpoint
CREATE TABLE `ultron_world_events` (
	`id` text PRIMARY KEY NOT NULL,
	`guild_id` text NOT NULL,
	`kind` text NOT NULL,
	`template_id` text NOT NULL,
	`status` text NOT NULL,
	`scheduled_by` text NOT NULL,
	`announce_at` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`max_hp` integer,
	`hp` integer,
	`boss_level` integer,
	`difficulty` text NOT NULL,
	`outcome` text,
	`channel_id` text,
	`announce_message_id` text,
	`message_id` text,
	`thread_id` text,
	`results_message_id` text,
	`embed_edited_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ultron_world_events_kind_start_uq` ON `ultron_world_events` (`guild_id`,`kind`,`starts_at`);--> statement-breakpoint
CREATE INDEX `ultron_world_events_status_idx` ON `ultron_world_events` (`status`);