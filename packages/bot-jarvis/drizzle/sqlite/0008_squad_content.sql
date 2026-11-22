ALTER TABLE `jarvis_missions` ADD `squad_id` text;--> statement-breakpoint
ALTER TABLE `jarvis_campaigns` ADD `squad_id` text;--> statement-breakpoint
ALTER TABLE `jarvis_trivia_questions` ADD `squad_id` text;--> statement-breakpoint
CREATE INDEX `jarvis_missions_squad_idx` ON `jarvis_missions` (`squad_id`);--> statement-breakpoint
CREATE INDEX `jarvis_campaigns_squad_idx` ON `jarvis_campaigns` (`squad_id`);--> statement-breakpoint
CREATE INDEX `jarvis_trivia_questions_squad_idx` ON `jarvis_trivia_questions` (`squad_id`);
