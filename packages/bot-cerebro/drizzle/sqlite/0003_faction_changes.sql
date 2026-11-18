CREATE TABLE `cerebro_faction_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`guild_id` text NOT NULL,
	`member_id` text NOT NULL,
	`from_faction` text,
	`to_faction` text NOT NULL,
	`reason` text NOT NULL,
	`source_key` text NOT NULL,
	`by_discord_user_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cerebro_faction_changes_source_unique` ON `cerebro_faction_changes` (`guild_id`,`source_key`);--> statement-breakpoint
CREATE INDEX `cerebro_faction_changes_member_idx` ON `cerebro_faction_changes` (`member_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `members` ADD `faction_changed_at` text;