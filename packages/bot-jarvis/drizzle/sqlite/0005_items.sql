CREATE TABLE `jarvis_equipment` (
	`member_id` text NOT NULL,
	`slot` text NOT NULL,
	`item_id` text NOT NULL,
	`guild_id` text NOT NULL,
	`equipped_at` text NOT NULL,
	PRIMARY KEY(`member_id`, `slot`)
);
--> statement-breakpoint
CREATE INDEX `jarvis_equipment_item_idx` ON `jarvis_equipment` (`item_id`);--> statement-breakpoint
CREATE TABLE `jarvis_inventory` (
	`member_id` text NOT NULL,
	`item_id` text NOT NULL,
	`guild_id` text NOT NULL,
	`source` text NOT NULL,
	`granted_by` text,
	`note` text,
	`acquired_at` text NOT NULL,
	PRIMARY KEY(`member_id`, `item_id`)
);
--> statement-breakpoint
CREATE TABLE `jarvis_items` (
	`id` text PRIMARY KEY NOT NULL,
	`slot` text NOT NULL,
	`min_level` integer NOT NULL,
	`cosmetic` integer NOT NULL,
	`price` integer,
	`definition` text NOT NULL,
	`content_hash` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`origin` text DEFAULT 'file' NOT NULL,
	`imported_by` text,
	`disabled_by` text,
	`updated_at` text NOT NULL
);
