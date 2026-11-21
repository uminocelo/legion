CREATE TABLE "core_audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"actor_discord_id" text NOT NULL,
	"source" text NOT NULL,
	"action" text NOT NULL,
	"target" text,
	"details" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core_dashboard_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"discord_user_id" text NOT NULL,
	"csrf_token" text NOT NULL,
	"created_at" text NOT NULL,
	"expires_at" text NOT NULL,
	"last_seen_at" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "core_audit_log_created_at_idx" ON "core_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "core_dashboard_sessions_expires_at_idx" ON "core_dashboard_sessions" USING btree ("expires_at");