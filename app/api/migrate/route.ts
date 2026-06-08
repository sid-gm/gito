import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export async function POST() {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS companies (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      ALTER TABLE tracked_entities
      ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE
    `);

    await db.execute(sql`
      ALTER TABLE reddit_subreddits
      ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE
    `);

    await db.execute(sql`
      ALTER TABLE reddit_subreddits
      DROP CONSTRAINT IF EXISTS reddit_subreddits_subreddit_name_unique
    `);

    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'reddit_subreddits_company_subreddit_unique'
        ) THEN
          ALTER TABLE reddit_subreddits
          ADD CONSTRAINT reddit_subreddits_company_subreddit_unique
          UNIQUE (company_id, subreddit_name);
        END IF;
      END
      $$
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS cluster_reports (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        cluster_id UUID NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
        company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
        snapshot_data JSONB NOT NULL,
        cluster_label TEXT,
        company_name TEXT,
        generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      ALTER TABLE clusters
      ADD COLUMN IF NOT EXISTS suggested_keywords JSONB
    `);

    await db.execute(sql`
      ALTER TABLE reddit_subreddits
      ADD COLUMN IF NOT EXISTS keyword_filters text[] NOT NULL DEFAULT '{}'
    `);

    await db.execute(sql`
      ALTER TABLE ingested_items DROP COLUMN IF EXISTS embedding
    `);

    await db.execute(sql`
      ALTER TABLE clusters DROP COLUMN IF EXISTS centroid_embedding
    `);

    await db.execute(sql`
      ALTER TABLE cluster_reports
      ADD COLUMN IF NOT EXISTS analyst_summary TEXT
    `);

    await db.execute(sql`
      ALTER TABLE ingested_items
      ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES ingested_items(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS root_post_id UUID REFERENCES ingested_items(id) ON DELETE SET NULL
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS tracked_threads (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
        platform "platform" NOT NULL,
        post_url TEXT NOT NULL,
        post_external_id TEXT,
        entity_id UUID REFERENCES tracked_entities(id) ON DELETE SET NULL,
        label TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_collected_at TIMESTAMPTZ,
        CONSTRAINT tracked_threads_company_url_unique UNIQUE (company_id, post_url)
      )
    `);

    return NextResponse.json({ ok: true, message: "Migration applied" });
  } catch (err) {
    console.error("[POST /api/migrate]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
