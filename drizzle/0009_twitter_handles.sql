CREATE TABLE IF NOT EXISTS "twitter_handles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid REFERENCES "companies"("id") ON DELETE cascade,
  "handle" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "twitter_handles_company_handle_unique" UNIQUE("company_id","handle")
);
