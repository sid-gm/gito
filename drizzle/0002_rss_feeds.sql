CREATE TABLE "rss_feeds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"label" text NOT NULL,
	"feed_url" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "rss_feeds_entity_url_unique" UNIQUE("entity_id","feed_url")
);
--> statement-breakpoint
ALTER TABLE "rss_feeds" ADD CONSTRAINT "rss_feeds_entity_id_tracked_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."tracked_entities"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "rss_feeds" ("id", "entity_id", "label", "feed_url", "created_at")
SELECT gen_random_uuid(), "id", "label", "google_alerts_feed_url", now()
FROM "tracked_entities"
WHERE "google_alerts_feed_url" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "tracked_entities" DROP COLUMN "google_alerts_feed_url";
