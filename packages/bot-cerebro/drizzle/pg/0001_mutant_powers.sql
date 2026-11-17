CREATE TABLE "cerebro_mutant_powers" (
	"id" text PRIMARY KEY NOT NULL,
	"mutant_id" text NOT NULL,
	"power_id" text NOT NULL,
	"slot" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "pending_powers" text;--> statement-breakpoint
CREATE UNIQUE INDEX "cerebro_mutant_powers_unique" ON "cerebro_mutant_powers" USING btree ("mutant_id","power_id");