CREATE TABLE "news_timeline_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rss_feed_id" uuid NOT NULL,
	"period_date" text NOT NULL,
	"ai_summary" text,
	"sentiment_score" real,
	"sentiment_label" text,
	"item_count" integer DEFAULT 0 NOT NULL,
	"generated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "news_timeline_days_feed_date_unique" UNIQUE("rss_feed_id","period_date")
);
--> statement-breakpoint
ALTER TABLE "news_timeline_days" ADD CONSTRAINT "news_timeline_days_rss_feed_id_rss_feeds_id_fk" FOREIGN KEY ("rss_feed_id") REFERENCES "public"."rss_feeds"("id") ON DELETE cascade ON UPDATE no action;
