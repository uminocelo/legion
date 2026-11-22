CREATE TABLE "jarvis_seasons" (
	"id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"status" text NOT NULL,
	"starts_at" text NOT NULL,
	"ends_at" text NOT NULL,
	"winners" text,
	"archive" text,
	"result_message_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "jarvis_seasons_start_uq" ON "jarvis_seasons" USING btree ("guild_id","starts_at");--> statement-breakpoint
CREATE INDEX "jarvis_seasons_status_idx" ON "jarvis_seasons" USING btree ("status");
