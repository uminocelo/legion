CREATE TABLE `cerebro_squads` (
	`id` text PRIMARY KEY NOT NULL,
	`guild_id` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`base_faction` text NOT NULL,
	`founder_member_id` text NOT NULL,
	`status` text NOT NULL,
	`code` text,
	`invite_code` text,
	`role_id` text,
	`thread_id` text,
	`requested_at` text NOT NULL,
	`decided_at` text,
	`decided_by` text,
	`refuse_reason` text
);
--> statement-breakpoint
CREATE TABLE `cerebro_squad_members` (
	`member_id` text PRIMARY KEY NOT NULL,
	`squad_id` text NOT NULL,
	`joined_at` text NOT NULL,
	`via` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `members` ADD `pending_squad_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `cerebro_squads_guild_name_unique` ON `cerebro_squads` (`guild_id`,`name_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `cerebro_squads_code_unique` ON `cerebro_squads` (`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `cerebro_squads_invite_code_unique` ON `cerebro_squads` (`invite_code`);--> statement-breakpoint
CREATE INDEX `cerebro_squads_guild_status_idx` ON `cerebro_squads` (`guild_id`,`status`);--> statement-breakpoint
CREATE INDEX `cerebro_squad_members_squad_idx` ON `cerebro_squad_members` (`squad_id`);
