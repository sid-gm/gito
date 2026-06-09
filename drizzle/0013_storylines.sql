-- Storylines: narrative arcs above clusters (clusters stay the event layer)
CREATE TABLE IF NOT EXISTS "storylines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "entity_id" uuid NOT NULL REFERENCES "tracked_entities"("id") ON DELETE cascade,
  "title" text NOT NULL,
  "summary" text,
  "status" text DEFAULT 'open' NOT NULL,
  "origin_cluster_id" uuid REFERENCES "clusters"("id") ON DELETE set null,
  "first_seen_at" timestamp NOT NULL,
  "last_seen_at" timestamp NOT NULL,
  "news_sentiment_score" real,
  "social_sentiment_score" real,
  "platform_lens" jsonb,
  "lens_generated_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE clusters
  ADD COLUMN IF NOT EXISTS "storyline_id" uuid REFERENCES "storylines"("id") ON DELETE SET NULL;
