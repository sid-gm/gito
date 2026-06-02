ALTER TABLE "reddit_subreddits" ADD COLUMN "keyword_filters" text[] NOT NULL DEFAULT '{}';
