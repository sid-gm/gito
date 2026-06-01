ALTER TABLE "ingested_items" ADD COLUMN "rss_feed_id" uuid;
--> statement-breakpoint
ALTER TABLE "ingested_items" ADD CONSTRAINT "ingested_items_rss_feed_id_rss_feeds_id_fk" FOREIGN KEY ("rss_feed_id") REFERENCES "public"."rss_feeds"("id") ON DELETE set null ON UPDATE no action;
