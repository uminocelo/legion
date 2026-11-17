ALTER TABLE `jarvis_missions` ADD `origin` text DEFAULT 'file' NOT NULL;--> statement-breakpoint
ALTER TABLE `jarvis_missions` ADD `imported_by` text;--> statement-breakpoint
ALTER TABLE `jarvis_missions` ADD `disabled_by` text;