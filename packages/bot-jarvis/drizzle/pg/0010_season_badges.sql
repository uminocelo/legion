CREATE TABLE "jarvis_season_badges" (
	"id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"season_id" text NOT NULL,
	"member_id" text NOT NULL,
	"place" integer NOT NULL,
	"xp" integer NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "jarvis_season_badges_season_member_uq" ON "jarvis_season_badges" USING btree ("season_id","member_id");--> statement-breakpoint
CREATE INDEX "jarvis_season_badges_member_idx" ON "jarvis_season_badges" USING btree ("member_id");
