CREATE TABLE `sentinel_flags_sent` (
	`subject_discord_user_id` text NOT NULL,
	`reason` text NOT NULL,
	`hour_bucket` text NOT NULL,
	PRIMARY KEY(`subject_discord_user_id`, `reason`, `hour_bucket`)
);
--> statement-breakpoint
CREATE TABLE `sentinel_moderation_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`report_id` text NOT NULL,
	`staff_discord_user_id` text NOT NULL,
	`action` text NOT NULL,
	`note` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sentinel_moderation_actions_report_idx` ON `sentinel_moderation_actions` (`report_id`);--> statement-breakpoint
CREATE TABLE `sentinel_rate_buckets` (
	`key` text NOT NULL,
	`window_start` text NOT NULL,
	`count` integer NOT NULL,
	PRIMARY KEY(`key`, `window_start`)
);
--> statement-breakpoint
CREATE INDEX `sentinel_rate_buckets_window_idx` ON `sentinel_rate_buckets` (`window_start`);--> statement-breakpoint
CREATE TABLE `sentinel_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`guild_id` text NOT NULL,
	`subject_discord_user_id` text NOT NULL,
	`reporter` text NOT NULL,
	`reporter_discord_user_id` text,
	`reason` text NOT NULL,
	`severity` text NOT NULL,
	`details` text NOT NULL,
	`refs` text NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`queue_message_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sentinel_reports_subject_idx` ON `sentinel_reports` (`subject_discord_user_id`,`reason`,`status`);--> statement-breakpoint
CREATE INDEX `sentinel_reports_status_idx` ON `sentinel_reports` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `sentinel_violations` (
	`id` text PRIMARY KEY NOT NULL,
	`discord_user_id` text NOT NULL,
	`policy` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sentinel_violations_user_idx` ON `sentinel_violations` (`discord_user_id`,`created_at`);