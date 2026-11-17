ALTER TABLE "ultron_enemy_templates" ADD COLUMN "origin" text DEFAULT 'file' NOT NULL;--> statement-breakpoint
ALTER TABLE "ultron_enemy_templates" ADD COLUMN "imported_by" text;--> statement-breakpoint
ALTER TABLE "ultron_enemy_templates" ADD COLUMN "disabled_by" text;