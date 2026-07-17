-- ============================================================================
-- FULL RESET — 2026-07-16 redesign (REDESIGN.md §4).
-- Drops every legacy table and enum, then creates the new schema from scratch.
-- ALL EXISTING DATA IS DESTROYED. Run drizzle/seed.sql afterwards to re-create
-- the company row + extension API key.
-- The drop section is idempotent, so this whole file can be re-run safely.
-- ============================================================================

-- Legacy tables (cluster/narrative era)
DROP TABLE IF EXISTS "cluster_reports" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "daily_briefs" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "cluster_merge_suggestions" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "cluster_news_links" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "entity_day_insights" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "cluster_period_narratives" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "cluster_items" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "cluster_merges" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "clusters" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "storylines" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "item_embeddings" CASCADE;--> statement-breakpoint
-- Legacy tables (old ingestion era)
DROP TABLE IF EXISTS "ingested_items" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "extension_collect_runs" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "news_timeline_days" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "threads_filters" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "tracked_entities" CASCADE;--> statement-breakpoint
-- Tables whose names survive but whose shapes change (recreated below)
DROP TABLE IF EXISTS "rss_feeds" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "reddit_subreddits" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "twitter_handles" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "tracked_user_handles" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "tracked_threads" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "companies" CASCADE;--> statement-breakpoint
-- New tables (no-ops on first run; make re-runs idempotent)
DROP TABLE IF EXISTS "engagement_snapshots" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "items" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "collect_run_events" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "collect_runs" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "collect_keywords" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "collect_settings" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "source_health" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "topics" CASCADE;--> statement-breakpoint
-- Legacy enums
DROP TYPE IF EXISTS "entity_type" CASCADE;--> statement-breakpoint
DROP TYPE IF EXISTS "cluster_classification" CASCADE;--> statement-breakpoint
DROP TYPE IF EXISTS "narrative_stage" CASCADE;--> statement-breakpoint
DROP TYPE IF EXISTS "item_signal" CASCADE;--> statement-breakpoint
DROP TYPE IF EXISTS "platform" CASCADE;--> statement-breakpoint
-- New enums (no-ops on first run; make re-runs idempotent)
DROP TYPE IF EXISTS "item_kind" CASCADE;--> statement-breakpoint
DROP TYPE IF EXISTS "published_at_precision" CASCADE;--> statement-breakpoint
DROP TYPE IF EXISTS "source_kind" CASCADE;--> statement-breakpoint
DROP TYPE IF EXISTS "extraction_method" CASCADE;--> statement-breakpoint
DROP TYPE IF EXISTS "run_trigger" CASCADE;--> statement-breakpoint
DROP TYPE IF EXISTS "run_status" CASCADE;--> statement-breakpoint
DROP TYPE IF EXISTS "run_event_status" CASCADE;--> statement-breakpoint
DROP TYPE IF EXISTS "health_state" CASCADE;--> statement-breakpoint
-- Old drizzle-kit migrate bookkeeping (journal restarted at 0000).
-- Uncomment ONLY if applying this file by hand in the SQL console — do not
-- run it through `drizzle-kit migrate`, which manages this schema itself.
-- DROP SCHEMA IF EXISTS "drizzle" CASCADE;

CREATE TYPE "public"."extraction_method" AS ENUM('dom', 'vision');--> statement-breakpoint
CREATE TYPE "public"."health_state" AS ENUM('ok', 'degraded', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."item_kind" AS ENUM('post', 'comment');--> statement-breakpoint
CREATE TYPE "public"."platform" AS ENUM('twitter', 'threads', 'reddit', 'instagram', 'facebook', 'linkedin', 'news', 'manual');--> statement-breakpoint
CREATE TYPE "public"."published_at_precision" AS ENUM('exact', 'approx', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."run_event_status" AS ENUM('ok', 'zero_results', 'http_403', 'logged_out', 'checkpoint', 'vision_fallback', 'error');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('running', 'ok', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."run_trigger" AS ENUM('auto', 'manual');--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('keyword_search', 'subreddit_new', 'subreddit_hot', 'tracked_thread', 'profile', 'manual', 'rss');--> statement-breakpoint
CREATE TABLE "collect_keywords" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"topic_id" uuid,
	"term" text NOT NULL,
	"platforms" text[] DEFAULT '{"twitter","threads","reddit"}' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collect_keywords_company_term_unique" UNIQUE("company_id","term"),
	CONSTRAINT "collect_keywords_platforms_check" CHECK ("collect_keywords"."platforms" <@ ARRAY['twitter','threads','reddit']::text[])
);
--> statement-breakpoint
CREATE TABLE "collect_run_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"platform" "platform" NOT NULL,
	"source_kind" "source_kind",
	"source_ref" text,
	"status" "run_event_status" NOT NULL,
	"detail" text,
	"items_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collect_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"triggered_by" "run_trigger" NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" "run_status" DEFAULT 'running' NOT NULL,
	"items_collected" integer DEFAULT 0 NOT NULL,
	"items_inserted" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collect_settings" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"interval_minutes" integer DEFAULT 30 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"paused_platforms" text[] DEFAULT '{}' NOT NULL,
	"max_thread_drills" integer DEFAULT 5 NOT NULL,
	"vision_disabled_platforms" text[] DEFAULT '{}' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"api_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_api_key_unique" UNIQUE("api_key")
);
--> statement-breakpoint
CREATE TABLE "engagement_snapshots" (
	"item_id" uuid NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"likes" integer,
	"replies" integer,
	"reposts" integer,
	"upvotes" integer,
	"views" bigint,
	CONSTRAINT "engagement_snapshots_item_id_captured_at_pk" PRIMARY KEY("item_id","captured_at")
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"platform" "platform" NOT NULL,
	"kind" "item_kind" NOT NULL,
	"external_id" text,
	"url" text,
	"author" text,
	"title" text,
	"body" text,
	"published_at" timestamp with time zone,
	"published_at_precision" "published_at_precision" DEFAULT 'unknown' NOT NULL,
	"parent_id" uuid,
	"root_post_id" uuid,
	"thread_key" text,
	"depth" integer,
	"topic_id" uuid,
	"sentiment_score" real,
	"sentiment_label" text,
	"sentiment_analyzed_at" timestamp with time zone,
	"source_kind" "source_kind" NOT NULL,
	"source_ref" text,
	"collect_run_id" uuid,
	"extraction_method" "extraction_method" DEFAULT 'dom' NOT NULL,
	"extraction_confidence" real,
	"dedupe_key" text,
	"latest_engagement" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "items_company_platform_external_id_unique" UNIQUE("company_id","platform","external_id")
);
--> statement-breakpoint
CREATE TABLE "reddit_subreddits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"subreddit_name" text NOT NULL,
	"sorts" text[] DEFAULT '{"new"}' NOT NULL,
	"keyword_filters" text[] DEFAULT '{}' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reddit_subreddits_company_subreddit_unique" UNIQUE("company_id","subreddit_name"),
	CONSTRAINT "reddit_subreddits_sorts_check" CHECK ("reddit_subreddits"."sorts" <@ ARRAY['new','hot']::text[])
);
--> statement-breakpoint
CREATE TABLE "rss_feeds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"topic_id" uuid,
	"label" text NOT NULL,
	"feed_url" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rss_feeds_company_url_unique" UNIQUE("company_id","feed_url")
);
--> statement-breakpoint
CREATE TABLE "source_health" (
	"company_id" uuid NOT NULL,
	"platform" "platform" NOT NULL,
	"state" "health_state" DEFAULT 'ok' NOT NULL,
	"since" timestamp with time zone DEFAULT now() NOT NULL,
	"last_ok_at" timestamp with time zone,
	"last_notified_at" timestamp with time zone,
	CONSTRAINT "source_health_company_id_platform_pk" PRIMARY KEY("company_id","platform")
);
--> statement-breakpoint
CREATE TABLE "topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "topics_company_label_unique" UNIQUE("company_id","label")
);
--> statement-breakpoint
CREATE TABLE "tracked_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"platform" "platform" NOT NULL,
	"post_url" text NOT NULL,
	"post_external_id" text,
	"topic_id" uuid,
	"label" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_collected_at" timestamp with time zone,
	CONSTRAINT "tracked_threads_company_url_unique" UNIQUE("company_id","post_url")
);
--> statement-breakpoint
CREATE TABLE "tracked_user_handles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"platform" "platform" NOT NULL,
	"username" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tracked_user_handles_unique" UNIQUE("company_id","platform","username")
);
--> statement-breakpoint
CREATE TABLE "twitter_handles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"handle" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "twitter_handles_company_handle_unique" UNIQUE("company_id","handle")
);
--> statement-breakpoint
ALTER TABLE "collect_keywords" ADD CONSTRAINT "collect_keywords_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collect_keywords" ADD CONSTRAINT "collect_keywords_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collect_run_events" ADD CONSTRAINT "collect_run_events_run_id_collect_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."collect_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collect_runs" ADD CONSTRAINT "collect_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collect_settings" ADD CONSTRAINT "collect_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_snapshots" ADD CONSTRAINT "engagement_snapshots_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_parent_id_items_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_root_post_id_items_id_fk" FOREIGN KEY ("root_post_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_collect_run_id_collect_runs_id_fk" FOREIGN KEY ("collect_run_id") REFERENCES "public"."collect_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reddit_subreddits" ADD CONSTRAINT "reddit_subreddits_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rss_feeds" ADD CONSTRAINT "rss_feeds_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rss_feeds" ADD CONSTRAINT "rss_feeds_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_health" ADD CONSTRAINT "source_health_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracked_threads" ADD CONSTRAINT "tracked_threads_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracked_threads" ADD CONSTRAINT "tracked_threads_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracked_user_handles" ADD CONSTRAINT "tracked_user_handles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "twitter_handles" ADD CONSTRAINT "twitter_handles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collect_run_events_run_idx" ON "collect_run_events" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "collect_run_events_platform_at_idx" ON "collect_run_events" USING btree ("platform","at");--> statement-breakpoint
CREATE INDEX "collect_runs_company_started_idx" ON "collect_runs" USING btree ("company_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "items_company_dedupe_key_unique" ON "items" USING btree ("company_id","dedupe_key") WHERE "items"."external_id" IS NULL AND "items"."dedupe_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "items_company_published_idx" ON "items" USING btree ("company_id","published_at");--> statement-breakpoint
CREATE INDEX "items_company_platform_idx" ON "items" USING btree ("company_id","platform");--> statement-breakpoint
CREATE INDEX "items_topic_idx" ON "items" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "items_root_post_idx" ON "items" USING btree ("root_post_id");--> statement-breakpoint
CREATE INDEX "items_thread_key_idx" ON "items" USING btree ("thread_key");--> statement-breakpoint
CREATE INDEX "items_collect_run_idx" ON "items" USING btree ("collect_run_id");--> statement-breakpoint
CREATE INDEX "items_unscored_idx" ON "items" USING btree ("created_at") WHERE "items"."sentiment_analyzed_at" IS NULL;