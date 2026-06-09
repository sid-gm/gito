-- LLM-proposed cluster merges awaiting analyst review (no auto-merge)
CREATE TABLE IF NOT EXISTS "cluster_merge_suggestions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "entity_id" uuid NOT NULL REFERENCES "tracked_entities"("id") ON DELETE cascade,
  "cluster_ids" jsonb NOT NULL,
  "suggested_label" text,
  "confidence" real,
  "reason" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "resolved_at" timestamp
);
