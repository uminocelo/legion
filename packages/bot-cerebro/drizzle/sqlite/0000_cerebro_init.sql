CREATE TABLE `cerebro_canon_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`attempted_name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cerebro_canon_attempts_member_idx` ON `cerebro_canon_attempts` (`member_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`guild_id` text NOT NULL,
	`discord_user_id` text NOT NULL,
	`onboarding_step` text NOT NULL,
	`rules_accepted_at` text,
	`faction` text,
	`pending_archetype` text,
	`rank` text DEFAULT 'recruta' NOT NULL,
	`opt_ins` text DEFAULT '[]' NOT NULL,
	`left_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `members_guild_user_unique` ON `members` (`guild_id`,`discord_user_id`);--> statement-breakpoint
CREATE INDEX `members_guild_step_idx` ON `members` (`guild_id`,`onboarding_step`);--> statement-breakpoint
CREATE TABLE `mutants` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`guild_id` text NOT NULL,
	`codename` text NOT NULL,
	`codename_normalized` text NOT NULL,
	`power` text NOT NULL,
	`archetype` text NOT NULL,
	`origin` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mutants_member_unique` ON `mutants` (`member_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `mutants_guild_codename_unique` ON `mutants` (`guild_id`,`codename_normalized`);