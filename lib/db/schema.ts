import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  pgEnum,
  unique,
  uniqueIndex,
  index,
  integer,
  bigint,
  real,
  primaryKey,
  boolean,
  check,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const platformEnum = pgEnum("platform", [
  "twitter",
  "threads",
  "reddit",
  "instagram",
  "facebook",
  "linkedin",
  "news",
  "manual",
]);

export const itemKindEnum = pgEnum("item_kind", ["post", "comment"]);

// 'exact' = platform gave a real timestamp; 'approx' = derived from a relative
// label ("2h ago", vision OCR); 'unknown' = platform gave nothing — never fake
// published_at to ingest time.
export const publishedAtPrecisionEnum = pgEnum("published_at_precision", [
  "exact",
  "approx",
  "unknown",
]);

export const sourceKindEnum = pgEnum("source_kind", [
  "keyword_search",
  "subreddit_new",
  "subreddit_hot",
  "tracked_thread",
  "profile",
  "manual",
  "rss",
]);

export const extractionMethodEnum = pgEnum("extraction_method", [
  "dom",
  "vision",
]);

export const runTriggerEnum = pgEnum("run_trigger", ["auto", "manual"]);

export const runStatusEnum = pgEnum("run_status", [
  "running",
  "ok",
  "partial",
  "failed",
]);

export const runEventStatusEnum = pgEnum("run_event_status", [
  "ok",
  "zero_results",
  "http_403",
  "logged_out",
  "checkpoint",
  "vision_fallback",
  "error",
]);

export const healthStateEnum = pgEnum("health_state", [
  "ok",
  "degraded",
  "blocked",
]);

// ---------------------------------------------------------------------------
// Companies & collection config
// ---------------------------------------------------------------------------

export const companies = pgTable("companies", {
  id:        uuid("id").defaultRandom().primaryKey(),
  name:      text("name").notNull(),
  apiKey:    text("api_key").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Topics = analysis grouping (header chips in the analyst UI). Items are
// assigned a topic by provenance: whichever keyword/subreddit/feed found them.
export const topics = pgTable("topics", {
  id:        uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }).notNull(),
  label:     text("label").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [unique("topics_company_label_unique").on(t.companyId, t.label)]);

// Search keywords owned by a topic. Keyword search sessions only run on
// twitter/threads/reddit — other platforms are collected via tracked
// threads, profiles, and manual capture.
export const collectKeywords = pgTable("collect_keywords", {
  id:        uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }).notNull(),
  // Nullable: popup quick-add lands unassigned, re-assignable on the site
  topicId:   uuid("topic_id").references(() => topics.id, { onDelete: "set null" }),
  term:      text("term").notNull(),
  platforms: text("platforms").array().notNull().default(["twitter", "threads", "reddit"]),
  isActive:  boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  unique("collect_keywords_company_term_unique").on(t.companyId, t.term),
  check("collect_keywords_platforms_check", sql`${t.platforms} <@ ARRAY['twitter','threads','reddit']::text[]`),
]);

export const redditSubreddits = pgTable("reddit_subreddits", {
  id:             uuid("id").defaultRandom().primaryKey(),
  companyId:      uuid("company_id").references(() => companies.id, { onDelete: "cascade" }).notNull(),
  subredditName:  text("subreddit_name").notNull(),
  sorts:          text("sorts").array().notNull().default(["new"]),
  keywordFilters: text("keyword_filters").array().notNull().default([]),
  isActive:       boolean("is_active").default(true).notNull(),
  createdAt:      timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  unique("reddit_subreddits_company_subreddit_unique").on(t.companyId, t.subredditName),
  check("reddit_subreddits_sorts_check", sql`${t.sorts} <@ ARRAY['new','hot']::text[]`),
]);

// Profile timelines to collect every run, one row per (platform, username).
// Consolidates the old twitter-only `twitter_handles` table into this generic
// one — profile collectors currently exist for twitter + threads.
export const profileHandles = pgTable("profile_handles", {
  id:        uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }).notNull(),
  platform:  platformEnum("platform").notNull(),
  username:  text("username").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [unique("profile_handles_unique").on(t.companyId, t.platform, t.username)]);

export const trackedThreads = pgTable("tracked_threads", {
  id:              uuid("id").defaultRandom().primaryKey(),
  companyId:       uuid("company_id").references(() => companies.id, { onDelete: "cascade" }).notNull(),
  platform:        platformEnum("platform").notNull(),
  postUrl:         text("post_url").notNull(),
  postExternalId:  text("post_external_id"),
  topicId:         uuid("topic_id").references(() => topics.id, { onDelete: "set null" }),
  label:           text("label"),
  isActive:        boolean("is_active").default(true).notNull(),
  createdAt:       timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  lastCollectedAt: timestamp("last_collected_at", { withTimezone: true }),
}, (t) => [unique("tracked_threads_company_url_unique").on(t.companyId, t.postUrl)]);

export const rssFeeds = pgTable("rss_feeds", {
  id:        uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }).notNull(),
  topicId:   uuid("topic_id").references(() => topics.id, { onDelete: "set null" }),
  label:     text("label").notNull(),
  feedUrl:   text("feed_url").notNull(),
  isActive:  boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [unique("rss_feeds_company_url_unique").on(t.companyId, t.feedUrl)]);

// One row per company. The extension pulls this (plus keywords/subreddits/
// handles/threads) as its config snapshot at the start of every run.
export const collectSettings = pgTable("collect_settings", {
  companyId:               uuid("company_id").references(() => companies.id, { onDelete: "cascade" }).primaryKey(),
  intervalMinutes:         integer("interval_minutes").default(30).notNull(),
  enabled:                 boolean("enabled").default(true).notNull(),
  pausedPlatforms:         text("paused_platforms").array().notNull().default([]),
  maxThreadDrills:         integer("max_thread_drills").default(5).notNull(),
  // Per-platform kill-switch for the screenshot/OCR fallback tier
  visionDisabledPlatforms: text("vision_disabled_platforms").array().notNull().default([]),
  updatedAt:               timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export const collectRuns = pgTable("collect_runs", {
  id:             uuid("id").defaultRandom().primaryKey(),
  companyId:      uuid("company_id").references(() => companies.id, { onDelete: "cascade" }).notNull(),
  triggeredBy:    runTriggerEnum("triggered_by").notNull(),
  startedAt:      timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  finishedAt:     timestamp("finished_at", { withTimezone: true }),
  status:         runStatusEnum("status").default("running").notNull(),
  itemsCollected: integer("items_collected").default(0).notNull(),
  itemsInserted:  integer("items_inserted").default(0).notNull(),
}, (t) => [index("collect_runs_company_started_idx").on(t.companyId, t.startedAt)]);

// ---------------------------------------------------------------------------
// Items — posts and comments, threaded for real
// ---------------------------------------------------------------------------

export const items = pgTable("items", {
  id:        uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }).notNull(),
  platform:  platformEnum("platform").notNull(),
  kind:      itemKindEnum("kind").notNull(),
  externalId: text("external_id"),
  url:        text("url"),
  author:     text("author"),
  title:      text("title"), // real titles only (reddit/news); never body[:200] copies
  body:       text("body"),
  publishedAt:          timestamp("published_at", { withTimezone: true }),
  publishedAtPrecision: publishedAtPrecisionEnum("published_at_precision").default("unknown").notNull(),
  // Threading (structural — replaces the old cluster-per-thread hack)
  parentId:   uuid("parent_id").references((): AnyPgColumn => items.id, { onDelete: "set null" }),
  rootPostId: uuid("root_post_id").references((): AnyPgColumn => items.id, { onDelete: "set null" }),
  threadKey:  text("thread_key"), // platform:root_external_id
  depth:      integer("depth"),   // reddit comment depth preserved
  // Analysis
  topicId:             uuid("topic_id").references(() => topics.id, { onDelete: "set null" }), // by provenance, editable
  sentimentScore:      real("sentiment_score"),
  sentimentLabel:      text("sentiment_label"),
  sentimentAnalyzedAt: timestamp("sentiment_analyzed_at", { withTimezone: true }),
  // Provenance
  sourceKind:   sourceKindEnum("source_kind").notNull(),
  sourceRef:    text("source_ref"), // the term / subreddit / handle / feed id
  collectRunId: uuid("collect_run_id").references(() => collectRuns.id, { onDelete: "set null" }),
  // Extraction tier
  extractionMethod:     extractionMethodEnum("extraction_method").default("dom").notNull(),
  extractionConfidence: real("extraction_confidence"), // mean OCR confidence for vision items
  dedupeKey:            text("dedupe_key"),            // hash(platform, author, body prefix)
  latestEngagement:     jsonb("latest_engagement").$type<{
    likes?: number; replies?: number; reposts?: number; upvotes?: number; views?: number;
  }>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  // Company-scoped so two companies can both ingest the same viral post
  unique("items_company_platform_external_id_unique").on(t.companyId, t.platform, t.externalId),
  // Vision items have no external id — dedupe on the content hash instead
  uniqueIndex("items_company_dedupe_key_unique")
    .on(t.companyId, t.dedupeKey)
    .where(sql`${t.externalId} IS NULL AND ${t.dedupeKey} IS NOT NULL`),
  index("items_company_published_idx").on(t.companyId, t.publishedAt),
  index("items_company_platform_idx").on(t.companyId, t.platform),
  index("items_topic_idx").on(t.topicId),
  index("items_root_post_idx").on(t.rootPostId),
  index("items_thread_key_idx").on(t.threadKey),
  index("items_collect_run_idx").on(t.collectRunId),
  // Sentiment batch scoring scans for unscored items
  index("items_unscored_idx").on(t.createdAt).where(sql`${t.sentimentAnalyzedAt} IS NULL`),
]);

// Re-scrapes of an already-seen item upsert a snapshot here (and refresh
// items.latest_engagement) instead of being dropped silently.
export const engagementSnapshots = pgTable("engagement_snapshots", {
  itemId:     uuid("item_id").references(() => items.id, { onDelete: "cascade" }).notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
  likes:   integer("likes"),
  replies: integer("replies"),
  reposts: integer("reposts"),
  upvotes: integer("upvotes"),
  views:   bigint("views", { mode: "number" }),
}, (t) => [primaryKey({ columns: [t.itemId, t.capturedAt] })]);

// ---------------------------------------------------------------------------
// Run events & source health
// ---------------------------------------------------------------------------

export const collectRunEvents = pgTable("collect_run_events", {
  id:         uuid("id").defaultRandom().primaryKey(),
  runId:      uuid("run_id").references(() => collectRuns.id, { onDelete: "cascade" }).notNull(),
  at:         timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  platform:   platformEnum("platform").notNull(),
  sourceKind: sourceKindEnum("source_kind"),
  sourceRef:  text("source_ref"),
  status:     runEventStatusEnum("status").notNull(),
  detail:     text("detail"),
  itemsCount: integer("items_count").default(0).notNull(),
}, (t) => [
  index("collect_run_events_run_idx").on(t.runId),
  index("collect_run_events_platform_at_idx").on(t.platform, t.at),
]);

// Per-platform health state machine — drives Telegram alerts (on state
// transitions, throttled) and the Sources view. Never alerts per-event.
export const sourceHealth = pgTable("source_health", {
  companyId:      uuid("company_id").references(() => companies.id, { onDelete: "cascade" }).notNull(),
  platform:       platformEnum("platform").notNull(),
  state:          healthStateEnum("state").default("ok").notNull(),
  since:          timestamp("since", { withTimezone: true }).defaultNow().notNull(),
  lastOkAt:       timestamp("last_ok_at", { withTimezone: true }),
  lastNotifiedAt: timestamp("last_notified_at", { withTimezone: true }),
}, (t) => [primaryKey({ columns: [t.companyId, t.platform] })]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
export type Topic = typeof topics.$inferSelect;
export type NewTopic = typeof topics.$inferInsert;
export type CollectKeyword = typeof collectKeywords.$inferSelect;
export type NewCollectKeyword = typeof collectKeywords.$inferInsert;
export type RedditSubreddit = typeof redditSubreddits.$inferSelect;
export type NewRedditSubreddit = typeof redditSubreddits.$inferInsert;
export type ProfileHandle = typeof profileHandles.$inferSelect;
export type NewProfileHandle = typeof profileHandles.$inferInsert;
export type TrackedThread = typeof trackedThreads.$inferSelect;
export type NewTrackedThread = typeof trackedThreads.$inferInsert;
export type RssFeed = typeof rssFeeds.$inferSelect;
export type NewRssFeed = typeof rssFeeds.$inferInsert;
export type CollectSettings = typeof collectSettings.$inferSelect;
export type NewCollectSettings = typeof collectSettings.$inferInsert;
export type CollectRun = typeof collectRuns.$inferSelect;
export type NewCollectRun = typeof collectRuns.$inferInsert;
export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
export type EngagementSnapshot = typeof engagementSnapshots.$inferSelect;
export type NewEngagementSnapshot = typeof engagementSnapshots.$inferInsert;
export type CollectRunEvent = typeof collectRunEvents.$inferSelect;
export type NewCollectRunEvent = typeof collectRunEvents.$inferInsert;
export type SourceHealth = typeof sourceHealth.$inferSelect;
export type NewSourceHealth = typeof sourceHealth.$inferInsert;

export type Platform = (typeof platformEnum.enumValues)[number];
export type ItemKind = (typeof itemKindEnum.enumValues)[number];
export type SourceKind = (typeof sourceKindEnum.enumValues)[number];
export type RunEventStatus = (typeof runEventStatusEnum.enumValues)[number];
export type HealthState = (typeof healthStateEnum.enumValues)[number];
