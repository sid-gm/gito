CREATE TYPE "public"."cluster_classification" AS ENUM('unclassified', 'narrative', 'noise');--> statement-breakpoint
CREATE TYPE "public"."entity_type" AS ENUM('keyword', 'executive', 'product');--> statement-breakpoint
CREATE TYPE "public"."item_signal" AS ENUM('unclassified', 'signal', 'noise', 'watch');--> statement-breakpoint
CREATE TYPE "public"."narrative_stage" AS ENUM('emerging', 'relaxed', 'developing', 'peaked', 'revival', 'declining');--> statement-breakpoint
CREATE TYPE "public"."platform" AS ENUM('hackernews', 'reddit', 'twitter', 'google_alerts', 'manual');--> statement-breakpoint
CREATE TABLE "cluster_items" (
	"cluster_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"similarity" real NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL,
	"item_signal" "item_signal" DEFAULT 'unclassified' NOT NULL,
	"signal_reason" text,
	"analyst_signal" text,
	"analyst_note" text,
	"analyst_flag" text,
	"merge_id" uuid,
	CONSTRAINT "cluster_items_cluster_id_item_id_pk" PRIMARY KEY("cluster_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "cluster_merges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"surviving_cluster_id" uuid NOT NULL,
	"absorbed_label" text,
	"absorbed_first_seen_at" timestamp NOT NULL,
	"absorbed_last_seen_at" timestamp NOT NULL,
	"absorbed_item_count" integer NOT NULL,
	"merged_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cluster_period_narratives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cluster_id" uuid NOT NULL,
	"period_date" text NOT NULL,
	"ai_narrative" text,
	"analyst_narrative" text,
	"generated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cluster_period_unique" UNIQUE("cluster_id","period_date")
);
--> statement-breakpoint
CREATE TABLE "clusters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid,
	"label" text,
	"centroid_embedding" vector(1536),
	"item_count" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp NOT NULL,
	"last_seen_at" timestamp NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"classification" "cluster_classification" DEFAULT 'unclassified' NOT NULL,
	"narrative_stage" "narrative_stage",
	"narrative_summary" text,
	"momentum" real,
	"peak_momentum" real,
	"velocity_24h" real,
	"prev_velocity_24h" real,
	"platform_count" integer,
	"classification_confidence" real,
	"analyst_classification" text,
	"analyst_note" text,
	"classified_at" timestamp,
	"sentiment_score" real,
	"sentiment_label" text,
	"sentiment_analyzed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingested_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid,
	"platform" "platform" NOT NULL,
	"external_id" text,
	"url" text,
	"title" text,
	"body" text,
	"author" text,
	"published_at" timestamp,
	"raw_json" jsonb,
	"subtype" text,
	"embedding" vector(1536),
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "platform_external_id_unique" UNIQUE("platform","external_id")
);
--> statement-breakpoint
CREATE TABLE "reddit_subreddits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"subreddit_name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "reddit_subreddits_company_subreddit_unique" UNIQUE("company_id","subreddit_name")
);
--> statement-breakpoint
CREATE TABLE "tracked_entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"label" text NOT NULL,
	"query_string" text NOT NULL,
	"entity_type" "entity_type" NOT NULL,
	"google_alerts_feed_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cluster_items" ADD CONSTRAINT "cluster_items_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_items" ADD CONSTRAINT "cluster_items_item_id_ingested_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."ingested_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_items" ADD CONSTRAINT "cluster_items_merge_id_cluster_merges_id_fk" FOREIGN KEY ("merge_id") REFERENCES "public"."cluster_merges"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_merges" ADD CONSTRAINT "cluster_merges_surviving_cluster_id_clusters_id_fk" FOREIGN KEY ("surviving_cluster_id") REFERENCES "public"."clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_period_narratives" ADD CONSTRAINT "cluster_period_narratives_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clusters" ADD CONSTRAINT "clusters_entity_id_tracked_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."tracked_entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingested_items" ADD CONSTRAINT "ingested_items_entity_id_tracked_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."tracked_entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reddit_subreddits" ADD CONSTRAINT "reddit_subreddits_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracked_entities" ADD CONSTRAINT "tracked_entities_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;