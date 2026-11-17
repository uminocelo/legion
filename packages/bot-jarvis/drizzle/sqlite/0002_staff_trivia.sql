CREATE TABLE `jarvis_trivia_edits` (
	`id` text PRIMARY KEY NOT NULL,
	`question_id` text NOT NULL,
	`staff_id` text NOT NULL,
	`action` text NOT NULL,
	`before` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `jarvis_trivia_edits_question_idx` ON `jarvis_trivia_edits` (`question_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `jarvis_trivia_questions` ADD `origin` text DEFAULT 'file' NOT NULL;--> statement-breakpoint
ALTER TABLE `jarvis_trivia_questions` ADD `review` text;--> statement-breakpoint
ALTER TABLE `jarvis_trivia_questions` ADD `created_by` text;--> statement-breakpoint
ALTER TABLE `jarvis_trivia_questions` ADD `reviewed_by` text;