import { sql } from "drizzle-orm";
import { items } from "@/lib/db/schema";

// Effective timestamp: honest published_at when we have it, ingest time otherwise
export const effectiveTs = sql`COALESCE(${items.publishedAt}, ${items.createdAt})`;

// Analyst views bucket days in Pacific time (the analyst's timezone)
export const pacificDay = sql<string>`(COALESCE(${items.publishedAt}, ${items.createdAt}) AT TIME ZONE 'America/Los_Angeles')::date`;

// Reach: crude engagement sum off the cached latest snapshot
export const reachScore = sql<number>`
  COALESCE((${items.latestEngagement}->>'likes')::int, 0)
  + COALESCE((${items.latestEngagement}->>'replies')::int, 0)
  + COALESCE((${items.latestEngagement}->>'reposts')::int, 0)
  + COALESCE((${items.latestEngagement}->>'upvotes')::int, 0)
`;
