ALTER TABLE "jarvis_missions" ADD COLUMN "squad_id" text;--> statement-breakpoint
ALTER TABLE "jarvis_campaigns" ADD COLUMN "squad_id" text;--> statement-breakpoint
ALTER TABLE "jarvis_trivia_questions" ADD COLUMN "squad_id" text;--> statement-breakpoint
CREATE INDEX "jarvis_missions_squad_idx" ON "jarvis_missions" USING btree ("squad_id");--> statement-breakpoint
CREATE INDEX "jarvis_campaigns_squad_idx" ON "jarvis_campaigns" USING btree ("squad_id");--> statement-breakpoint
CREATE INDEX "jarvis_trivia_questions_squad_idx" ON "jarvis_trivia_questions" USING btree ("squad_id");
