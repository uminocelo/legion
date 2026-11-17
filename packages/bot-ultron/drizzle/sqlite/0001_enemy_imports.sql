ALTER TABLE `ultron_enemy_templates` ADD `origin` text DEFAULT 'file' NOT NULL;--> statement-breakpoint
ALTER TABLE `ultron_enemy_templates` ADD `imported_by` text;--> statement-breakpoint
ALTER TABLE `ultron_enemy_templates` ADD `disabled_by` text;