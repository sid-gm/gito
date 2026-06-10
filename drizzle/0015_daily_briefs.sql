-- Daily Executive Brief: per-company per-Pacific-day LLM snapshot
CREATE TABLE IF NOT EXISTS "daily_briefs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "period_date" text NOT NULL,
  "snapshot_data" jsonb NOT NULL,
  "generated_at" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "daily_briefs_company_date_unique" UNIQUE ("company_id", "period_date")
);
