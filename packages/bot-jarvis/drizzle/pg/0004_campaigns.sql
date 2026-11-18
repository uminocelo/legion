CREATE TABLE "jarvis_campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"faction" text,
	"definition" text NOT NULL,
	"content_hash" text NOT NULL,
	"active" integer DEFAULT 1 NOT NULL,
	"origin" text DEFAULT 'file' NOT NULL,
	"imported_by" text,
	"disabled_by" text,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jarvis_missions" ADD COLUMN "campaign_id" text;--> statement-breakpoint
ALTER TABLE "jarvis_missions" ADD COLUMN "chapter" integer;--> statement-breakpoint
ALTER TABLE "jarvis_missions" ADD COLUMN "requires" text;--> statement-breakpoint
CREATE INDEX "jarvis_missions_campaign_idx" ON "jarvis_missions" USING btree ("campaign_id","chapter");