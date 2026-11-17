ALTER TABLE "jarvis_missions" ADD COLUMN "origin" text DEFAULT 'file' NOT NULL;--> statement-breakpoint
ALTER TABLE "jarvis_missions" ADD COLUMN "imported_by" text;--> statement-breakpoint
ALTER TABLE "jarvis_missions" ADD COLUMN "disabled_by" text;