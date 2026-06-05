import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  pgEnum,
  unique,
  integer,
  real,
  primaryKey,
  boolean,
} from "drizzle-orm/pg-core";

export const entityTypeEnum = pgEnum("entity_type", [
  "keyword",
  "executive",
  "product",
]);

export const clusterClassificationEnum = pgEnum("cluster_classification", [
  "unclassified",
  "narrative",
  "noise",
]);

export const narrativeStageEnum = pgEnum("narrative_stage", [
  "emerging",
  "relaxed",
  "developing",
  "peaked",
  "revival",
  "declining",
]);

export const itemSignalEnum = pgEnum("item_signal", [
  "unclassified",
  "signal",
  "noise",
  "watch",
]);

export const platformEnum = pgEnum("platform", [
  "hackernews",
  "reddit",
  "twitter",
  "google_alerts",
  "manual",
  "threads",
  "instagram",
]);

export const companies = pgTable("companies", {
  id:        uuid("id").defaultRandom().primaryKey(),
  name:      text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const trackedEntities = pgTable("tracked_entities", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  queryString: text("query_string").notNull(),
  entityType: entityTypeEnum("entity_type").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const rssFeeds = pgTable("rss_feeds", {
  id:        uuid("id").defaultRandom().primaryKey(),
  entityId:  uuid("entity_id").references(() => trackedEntities.id, { onDelete: "cascade" }).notNull(),
  label:     text("label").notNull(),
  feedUrl:   text("feed_url").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [unique("rss_feeds_entity_url_unique").on(t.entityId, t.feedUrl)]);

export const newsTimelineDays = pgTable("news_timeline_days", {
  id:             uuid("id").defaultRandom().primaryKey(),
  rssFeedId:      uuid("rss_feed_id").references(() => rssFeeds.id, { onDelete: "cascade" }).notNull(),
  periodDate:     text("period_date").notNull(),
  aiSummary:      text("ai_summary"),
  sentimentScore: real("sentiment_score"),
  sentimentLabel: text("sentiment_label"),
  itemCount:      integer("item_count").default(0).notNull(),
  stories:        jsonb("stories").$type<Array<{ label: string; summary: string; sentiment: string; score: number; count: number }>>(),
  generatedAt:    timestamp("generated_at"),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
  updatedAt:      timestamp("updated_at").defaultNow().notNull(),
}, (t) => [unique("news_timeline_days_feed_date_unique").on(t.rssFeedId, t.periodDate)]);

export const ingestedItems = pgTable(
  "ingested_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    entityId: uuid("entity_id").references(() => trackedEntities.id, {
      onDelete: "set null",
    }),
    rssFeedId: uuid("rss_feed_id").references(() => rssFeeds.id, { onDelete: "set null" }),
    platform: platformEnum("platform").notNull(),
    externalId: text("external_id"),
    url: text("url"),
    title: text("title"),
    body: text("body"),
    author: text("author"),
    publishedAt: timestamp("published_at"),
    rawJson: jsonb("raw_json"),
    subtype: text("subtype"),
    showInNewsTimeline: boolean("show_in_news_timeline").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [unique("platform_external_id_unique").on(t.platform, t.externalId)]
);

export const clusters = pgTable("clusters", {
  id: uuid("id").defaultRandom().primaryKey(),
  entityId: uuid("entity_id").references(() => trackedEntities.id, { onDelete: "cascade" }),
  label: text("label"),
  itemCount: integer("item_count").default(1).notNull(),
  firstSeenAt: timestamp("first_seen_at").notNull(),
  lastSeenAt: timestamp("last_seen_at").notNull(),
  archivedAt: timestamp("archived_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  // Classification fields
  classification: clusterClassificationEnum("classification").default("unclassified").notNull(),
  narrativeStage: narrativeStageEnum("narrative_stage"),
  narrativeSummary: text("narrative_summary"),
  momentum: real("momentum"),
  peakMomentum: real("peak_momentum"),
  velocity24h: real("velocity_24h"),
  prevVelocity24h: real("prev_velocity_24h"),
  platformCount: integer("platform_count"),
  classificationConfidence: real("classification_confidence"),
  analystClassification: text("analyst_classification"), // 'narrative' | 'noise'
  analystNote: text("analyst_note"),
  classifiedAt: timestamp("classified_at"),
  // Sentiment fields
  sentimentScore: real("sentiment_score"),
  sentimentLabel: text("sentiment_label"),
  sentimentAnalyzedAt: timestamp("sentiment_analyzed_at"),
  // LLM-suggested keywords when the cluster was formed
  suggestedKeywords: jsonb("suggested_keywords").$type<string[]>(),
});

// Tracks merge history — one row per absorbed cluster
export const clusterMerges = pgTable("cluster_merges", {
  id: uuid("id").defaultRandom().primaryKey(),
  survivingClusterId: uuid("surviving_cluster_id")
    .references(() => clusters.id, { onDelete: "cascade" })
    .notNull(),
  absorbedLabel: text("absorbed_label"),
  absorbedFirstSeenAt: timestamp("absorbed_first_seen_at").notNull(),
  absorbedLastSeenAt: timestamp("absorbed_last_seen_at").notNull(),
  absorbedItemCount: integer("absorbed_item_count").notNull(),
  mergedAt: timestamp("merged_at").defaultNow().notNull(),
});

export const clusterItems = pgTable(
  "cluster_items",
  {
    clusterId: uuid("cluster_id")
      .references(() => clusters.id, { onDelete: "cascade" })
      .notNull(),
    itemId: uuid("item_id")
      .references(() => ingestedItems.id, { onDelete: "cascade" })
      .notNull(),
    similarity: real("similarity").notNull(),
    addedAt: timestamp("added_at").defaultNow().notNull(),
    // Signal classification
    itemSignal: itemSignalEnum("item_signal").default("unclassified").notNull(),
    signalReason: text("signal_reason"),
    analystSignal: text("analyst_signal"), // 'signal' | 'noise' | 'watch'
    analystNote: text("analyst_note"),
    analystFlag: text("analyst_flag"), // null | 'review' | 'highlight'
    // Merge provenance — null means item was original to this cluster
    mergeId: uuid("merge_id").references(() => clusterMerges.id, { onDelete: "set null" }),
  },
  (t) => [primaryKey({ columns: [t.clusterId, t.itemId] })]
);

export const clusterPeriodNarratives = pgTable(
  "cluster_period_narratives",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clusterId: uuid("cluster_id")
      .references(() => clusters.id, { onDelete: "cascade" })
      .notNull(),
    periodDate: text("period_date").notNull(), // "YYYY-MM-DD" UTC
    aiNarrative: text("ai_narrative"),
    analystNarrative: text("analyst_narrative"),
    generatedAt: timestamp("generated_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [unique("cluster_period_unique").on(t.clusterId, t.periodDate)]
);

export const redditSubreddits = pgTable("reddit_subreddits", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
  subredditName: text("subreddit_name").notNull(),
  keywordFilters: text("keyword_filters").array().notNull().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [unique("reddit_subreddits_company_subreddit_unique").on(t.companyId, t.subredditName)]);

export const twitterHandles = pgTable("twitter_handles", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
  handle: text("handle").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [unique("twitter_handles_company_handle_unique").on(t.companyId, t.handle)]);

export const threadsFilters = pgTable("threads_filters", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
  filterType: text("filter_type").notNull(), // 'keyword' | 'user'
  value: text("value").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [unique("threads_filters_company_type_value_unique").on(t.companyId, t.filterType, t.value)]);

export const clusterReports = pgTable("cluster_reports", {
  id: uuid("id").defaultRandom().primaryKey(),
  clusterId: uuid("cluster_id")
    .references(() => clusters.id, { onDelete: "cascade" })
    .notNull(),
  companyId: uuid("company_id")
    .references(() => companies.id, { onDelete: "cascade" }),
  snapshotData: jsonb("snapshot_data").notNull(),
  clusterLabel: text("cluster_label"),
  companyName: text("company_name"),
  analystSummary: text("analyst_summary"),
  generatedAt: timestamp("generated_at").defaultNow().notNull(),
});

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
export type TrackedEntity = typeof trackedEntities.$inferSelect;
export type NewTrackedEntity = typeof trackedEntities.$inferInsert;
export type IngestedItem = typeof ingestedItems.$inferSelect;
export type NewIngestedItem = typeof ingestedItems.$inferInsert;
export type Cluster = typeof clusters.$inferSelect;
export type NewCluster = typeof clusters.$inferInsert;
export type ClusterItem = typeof clusterItems.$inferSelect;
export type ClusterPeriodNarrative = typeof clusterPeriodNarratives.$inferSelect;
export type ClusterMerge = typeof clusterMerges.$inferSelect;
export type TwitterHandle = typeof twitterHandles.$inferSelect;
export type NewTwitterHandle = typeof twitterHandles.$inferInsert;
export type ThreadsFilter = typeof threadsFilters.$inferSelect;
export type RedditSubreddit = typeof redditSubreddits.$inferSelect;
export type NewRedditSubreddit = typeof redditSubreddits.$inferInsert;
export type ClusterReport = typeof clusterReports.$inferSelect;
export type RssFeed = typeof rssFeeds.$inferSelect;
export type NewRssFeed = typeof rssFeeds.$inferInsert;
export type NewsTimelineDay = typeof newsTimelineDays.$inferSelect;
export type NewNewsTimelineDay = typeof newsTimelineDays.$inferInsert;

export type ClusterClassification = "unclassified" | "narrative" | "noise";
export type NarrativeStage = "relaxed" | "emerging" | "developing" | "peaked" | "revival" | "declining";
export type ItemSignal = "unclassified" | "signal" | "noise" | "watch";
