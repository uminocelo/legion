CREATE TABLE "jarvis_wallet_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"member_id" text NOT NULL,
	"amount" integer NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"source_key" text NOT NULL,
	"created_by" text,
	"day" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jarvis_wallets" (
	"member_id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "jarvis_wallets_balance_nonneg" CHECK ("jarvis_wallets"."balance" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "jarvis_wallet_ledger_source_unique" ON "jarvis_wallet_ledger" USING btree ("source_key");--> statement-breakpoint
CREATE INDEX "jarvis_wallet_ledger_guild_created_idx" ON "jarvis_wallet_ledger" USING btree ("guild_id","created_at");--> statement-breakpoint
CREATE INDEX "jarvis_wallet_ledger_member_idx" ON "jarvis_wallet_ledger" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "jarvis_wallets_guild_idx" ON "jarvis_wallets" USING btree ("guild_id");