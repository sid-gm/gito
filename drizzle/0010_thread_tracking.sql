-- Add parent linking to ingested_items
ALTER TABLE ingested_items
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES ingested_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS root_post_id UUID REFERENCES ingested_items(id) ON DELETE SET NULL;

-- Tracked threads for auto-collect revisiting
CREATE TABLE IF NOT EXISTS "tracked_threads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid REFERENCES "companies"("id") ON DELETE cascade,
  "platform" "platform" NOT NULL,
  "post_url" text NOT NULL,
  "post_external_id" text,
  "entity_id" uuid REFERENCES "tracked_entities"("id") ON DELETE set null,
  "label" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "last_collected_at" timestamp,
  CONSTRAINT "tracked_threads_company_url_unique" UNIQUE ("company_id", "post_url")
);
