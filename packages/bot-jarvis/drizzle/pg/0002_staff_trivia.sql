CREATE TABLE "jarvis_trivia_edits" (
	"id" text PRIMARY KEY NOT NULL,
	"question_id" text NOT NULL,
	"staff_id" text NOT NULL,
	"action" text NOT NULL,
	"before" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jarvis_trivia_questions" ADD COLUMN "origin" text DEFAULT 'file' NOT NULL;--> statement-breakpoint
ALTER TABLE "jarvis_trivia_questions" ADD COLUMN "review" text;--> statement-breakpoint
ALTER TABLE "jarvis_trivia_questions" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "jarvis_trivia_questions" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
CREATE INDEX "jarvis_trivia_edits_question_idx" ON "jarvis_trivia_edits" USING btree ("question_id","created_at");