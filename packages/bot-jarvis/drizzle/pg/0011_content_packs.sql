CREATE TABLE "jarvis_content_packs" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"version" text NOT NULL,
	"author" text NOT NULL,
	"source" text NOT NULL,
	"installed_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"definition" text
);
--> statement-breakpoint
CREATE TABLE "jarvis_content_pack_items" (
	"pack_id" text NOT NULL,
	"content_type" text NOT NULL,
	"content_id" text NOT NULL,
	"version" text NOT NULL,
	CONSTRAINT "jarvis_content_pack_items_pack_id_content_type_content_id_pk" PRIMARY KEY("pack_id","content_type","content_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "jarvis_content_pack_items_content_uq" ON "jarvis_content_pack_items" USING btree ("content_type","content_id");--> statement-breakpoint
CREATE INDEX "jarvis_content_pack_items_pack_idx" ON "jarvis_content_pack_items" USING btree ("pack_id");
