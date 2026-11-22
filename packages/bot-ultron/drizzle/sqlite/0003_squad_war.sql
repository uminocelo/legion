ALTER TABLE `ultron_war_points` ADD `squad_id` text;--> statement-breakpoint
CREATE INDEX `ultron_war_points_squad_idx` ON `ultron_war_points` (`war_id`,`squad_id`);
