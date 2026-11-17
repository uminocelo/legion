CREATE TABLE `herbie_preferences` (
	`member_id` text PRIMARY KEY NOT NULL,
	`locale` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `herbie_tip_log` (
	`id` text PRIMARY KEY NOT NULL,
	`guild_id` text NOT NULL,
	`tip_id` text NOT NULL,
	`posted_at` text NOT NULL,
	`cycle` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `herbie_tip_log_guild_cycle_idx` ON `herbie_tip_log` (`guild_id`,`cycle`);--> statement-breakpoint
CREATE TABLE `herbie_tutorial_progress` (
	`member_id` text PRIMARY KEY NOT NULL,
	`guild_id` text NOT NULL,
	`chain_id` text NOT NULL,
	`current_step_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`delivery_fallback` integer DEFAULT 0 NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `herbie_tutorial_progress_guild_status_idx` ON `herbie_tutorial_progress` (`guild_id`,`status`);--> statement-breakpoint
CREATE TABLE `herbie_tutorial_steps_done` (
	`member_id` text NOT NULL,
	`step_id` text NOT NULL,
	`trigger_event_id` text NOT NULL,
	`xp_granted` integer DEFAULT 0 NOT NULL,
	`completed_at` text NOT NULL,
	PRIMARY KEY(`member_id`, `step_id`)
);
--> statement-breakpoint
CREATE TABLE `herbie_world_event_posts` (
	`world_event_id` text PRIMARY KEY NOT NULL,
	`message_id` text,
	`posted_at` text NOT NULL
);
