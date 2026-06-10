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

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS cluster_news_links (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        cluster_id UUID NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
        news_item_id UUID REFERENCES ingested_items(id) ON DELETE SET NULL,
        headline TEXT NOT NULL,
        url TEXT,
        published_at TIMESTAMP,
        relationship TEXT NOT NULL,
        explanation TEXT,
        confidence REAL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS cluster_merge_suggestions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        entity_id UUID NOT NULL REFERENCES tracked_entities(id) ON DELETE CASCADE,
        cluster_ids JSONB NOT NULL,
        suggested_label TEXT,
        confidence REAL,
        reason TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        resolved_at TIMESTAMP
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS storylines (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        entity_id UUID NOT NULL REFERENCES tracked_entities(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        summary TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        origin_cluster_id UUID REFERENCES clusters(id) ON DELETE SET NULL,
        first_seen_at TIMESTAMP NOT NULL,
        last_seen_at TIMESTAMP NOT NULL,
        news_sentiment_score REAL,
        social_sentiment_score REAL,
        platform_lens JSONB,
        lens_generated_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      ALTER TABLE clusters
      ADD COLUMN IF NOT EXISTS storyline_id UUID REFERENCES storylines(id) ON DELETE SET NULL
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS entity_day_insights (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        entity_id UUID NOT NULL REFERENCES tracked_entities(id) ON DELETE CASCADE,
        period_date TEXT NOT NULL,
        news_score REAL,
        social_score REAL,
        divergence REAL,
        driver_summary TEXT,
        top_cluster_ids JSONB,
        generated_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT entity_day_insights_entity_date_unique UNIQUE (entity_id, period_date)
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS daily_briefs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        period_date TEXT NOT NULL,
        snapshot_data JSONB NOT NULL,
        generated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT daily_briefs_company_date_unique UNIQUE (company_id, period_date)
      )
    `);

    return NextResponse.json({ ok: true, message: "Migration applied" });
  } catch (err) {
    console.error("[POST /api/migrate]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
