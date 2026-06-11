-- Per-item sentiment towards the tracked entity (batched LLM scoring).
-- Forward-only via cron/classify; historical windows via /api/run/backfill-item-sentiment.
ALTER TABLE "ingested_items" ADD COLUMN IF NOT EXISTS "sentiment_score" real;
ALTER TABLE "ingested_items" ADD COLUMN IF NOT EXISTS "sentiment_label" text;
ALTER TABLE "ingested_items" ADD COLUMN IF NOT EXISTS "sentiment_analyzed_at" timestamp;
