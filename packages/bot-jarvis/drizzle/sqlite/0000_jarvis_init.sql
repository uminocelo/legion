CREATE TABLE `jarvis_progress` (
	`member_id` text PRIMARY KEY NOT NULL,
	`guild_id` text NOT NULL,
	`xp` integer DEFAULT 0 NOT NULL,
	`level` integer DEFAULT 1 NOT NULL,
	`rank` text DEFAULT 'recruta' NOT NULL,
	`current_streak` integer DEFAULT 0 NOT NULL,
	`best_streak` integer DEFAULT 0 NOT NULL,
	`last_active_day` text,
	`trivia_xp_today` integer DEFAULT 0 NOT NULL,
	`trivia_xp_day` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `jarvis_progress_guild_xp_idx` ON `jarvis_progress` (`guild_id`,`xp`);--> statement-breakpoint
CREATE TABLE `jarvis_trivia_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`guild_id` text NOT NULL,
	`member_id` text NOT NULL,
	`question_id` text NOT NULL,
	`choice_order` text NOT NULL,
	`status` text NOT NULL,
	`chosen_index` integer,
	`correct` integer,
	`ms_to_answer` integer,
	`xp_awarded` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`answered_at` text
);
--> statement-breakpoint
CREATE INDEX `jarvis_trivia_attempts_member_idx` ON `jarvis_trivia_attempts` (`member_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `jarvis_trivia_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`locale` text NOT NULL,
	`category` text NOT NULL,
	`difficulty` text NOT NULL,
	`question` text NOT NULL,
	`choices` text NOT NULL,
	`answer_index` integer NOT NULL,
	`explanation` text NOT NULL,
	`source` text NOT NULL,
	`content_hash` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `jarvis_trivia_questions_pick_idx` ON `jarvis_trivia_questions` (`locale`,`category`,`active`);--> statement-breakpoint
CREATE TABLE `jarvis_xp_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`guild_id` text NOT NULL,
	`member_id` text NOT NULL,
	`amount` integer NOT NULL,
	`reason` text NOT NULL,
	`note` text,
	`source_key` text NOT NULL,
	`day` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jarvis_xp_ledger_source_unique` ON `jarvis_xp_ledger` (`source_key`);--> statement-breakpoint
CREATE INDEX `jarvis_xp_ledger_guild_created_idx` ON `jarvis_xp_ledger` (`guild_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `jarvis_xp_ledger_member_idx` ON `jarvis_xp_ledger` (`member_id`);--> statement-breakpoint
CREATE INDEX `jarvis_xp_ledger_guild_day_idx` ON `jarvis_xp_ledger` (`guild_id`,`day`);