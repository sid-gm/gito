-- Per-entity per-day insight: news vs social sentiment gap + LLM driver summary
CREATE TABLE IF NOT EXISTS "entity_day_insights" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "entity_id" uuid NOT NULL REFERENCES "tracked_entities"("id") ON DELETE cascade,
  "period_date" text NOT NULL,
  "news_score" real,
  "social_score" real,
  "divergence" real,
  "driver_summary" text,
  "top_cluster_ids" jsonb,
  "generated_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "entity_day_insights_entity_date_unique" UNIQUE ("entity_id", "period_date")
);
