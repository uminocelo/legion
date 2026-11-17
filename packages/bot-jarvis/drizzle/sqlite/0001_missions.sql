CREATE TABLE `jarvis_mission_choices` (
	`run_id` text NOT NULL,
	`scene_id` text NOT NULL,
	`member_id` text NOT NULL,
	`choice` integer NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`run_id`, `scene_id`, `member_id`)
);
--> statement-breakpoint
CREATE TABLE `jarvis_mission_members` (
	`run_id` text NOT NULL,
	`member_id` text NOT NULL,
	`joined_at` text NOT NULL,
	PRIMARY KEY(`run_id`, `member_id`)
);
--> statement-breakpoint
CREATE INDEX `jarvis_mission_members_member_idx` ON `jarvis_mission_members` (`member_id`);--> statement-breakpoint
CREATE TABLE `jarvis_mission_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`guild_id` text NOT NULL,
	`mission_id` text NOT NULL,
	`kind` text NOT NULL,
	`leader_member_id` text NOT NULL,
	`status` text NOT NULL,
	`scene_id` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`locale` text NOT NULL,
	`channel_id` text NOT NULL,
	`thread_id` text,
	`posted_scene` text,
	`message_id` text,
	`day` text NOT NULL,
	`week` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`ended_at` text
);
--> statement-breakpoint
CREATE INDEX `jarvis_mission_runs_status_idx` ON `jarvis_mission_runs` (`guild_id`,`status`);--> statement-breakpoint
CREATE INDEX `jarvis_mission_runs_mission_idx` ON `jarvis_mission_runs` (`mission_id`);--> statement-breakpoint
CREATE TABLE `jarvis_missions` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`min_level` integer NOT NULL,
	`party` integer NOT NULL,
	`difficulty` text NOT NULL,
	`has_combat` integer NOT NULL,
	`definition` text NOT NULL,
	`content_hash` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL
);
