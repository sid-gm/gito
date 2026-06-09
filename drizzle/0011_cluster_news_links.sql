-- News articles linked to clusters of social discussion (news stays out of cluster membership).
-- headline/url/published_at are denormalized so links survive the 7-day news purge.
CREATE TABLE IF NOT EXISTS "cluster_news_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "cluster_id" uuid NOT NULL REFERENCES "clusters"("id") ON DELETE cascade,
  "news_item_id" uuid REFERENCES "ingested_items"("id") ON DELETE set null,
  "headline" text NOT NULL,
  "url" text,
  "published_at" timestamp,
  "relationship" text NOT NULL,
  "explanation" text,
  "confidence" real,
  "created_at" timestamp DEFAULT now() NOT NULL
);
