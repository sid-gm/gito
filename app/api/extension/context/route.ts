import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  companies,
  topics,
  collectKeywords,
  redditSubreddits,
  profileHandles,
  trackedThreads,
  collectSettings,
} from "@/lib/db/schema";
import { verifyExtensionKey } from "@/lib/extension-auth";
import { and, eq, sql } from "drizzle-orm";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

// Full config snapshot — the extension pulls this at the start of EVERY run
// (never caches config in chrome.storage), so site edits apply on the next run.
export async function GET(req: Request) {
  const companyId = await verifyExtensionKey(req);
  if (!companyId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: CORS });
  }

  const [company] = await db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(eq(companies.id, companyId));
  if (!company) {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: CORS });
  }

  // Settings row is lazily created so a freshly seeded company works
  await db.insert(collectSettings).values({ companyId }).onConflictDoNothing();

  const [settings] = await db
    .select()
    .from(collectSettings)
    .where(eq(collectSettings.companyId, companyId));

  const [topicRows, keywords, subreddits, profiles, threads] = await Promise.all([
    db
      .select({ id: topics.id, label: topics.label })
      .from(topics)
      .where(eq(topics.companyId, companyId))
      .orderBy(topics.label),
    db
      .select({
        id: collectKeywords.id,
        term: collectKeywords.term,
        platforms: collectKeywords.platforms,
        topicId: collectKeywords.topicId,
      })
      .from(collectKeywords)
      .where(and(eq(collectKeywords.companyId, companyId), eq(collectKeywords.isActive, true))),
    db
      .select({
        subredditName: redditSubreddits.subredditName,
        sorts: redditSubreddits.sorts,
        keywordFilters: redditSubreddits.keywordFilters,
      })
      .from(redditSubreddits)
      .where(and(eq(redditSubreddits.companyId, companyId), eq(redditSubreddits.isActive, true))),
    db
      .select({ platform: profileHandles.platform, username: profileHandles.username })
      .from(profileHandles)
      .where(eq(profileHandles.companyId, companyId)),
    db
      .select({
        url: trackedThreads.postUrl,
        platform: trackedThreads.platform,
        externalId: trackedThreads.postExternalId,
        topicId: trackedThreads.topicId,
      })
      .from(trackedThreads)
      .where(and(
        eq(trackedThreads.companyId, companyId),
        eq(trackedThreads.isActive, true),
        // Skip auto-promoted threads whose 1-week window has passed. Manual
        // adds have a null expiry and are always served.
        sql`(${trackedThreads.expiresAt} IS NULL OR ${trackedThreads.expiresAt} > now())`,
      )),
  ]);

  return NextResponse.json(
    {
      companyId: company.id,
      companyName: company.name,
      topics: topicRows,
      keywords,
      redditSubreddits: subreddits,
      // Canonical: every tracked profile timeline, one row per (platform, username).
      profiles,
      // Transitional aliases for extension builds from before the profile_handles
      // merge — safe to remove once every worker has reloaded.
      twitterAccounts: profiles.filter((p) => p.platform === "twitter").map((p) => p.username),
      trackedProfiles: profiles,
      trackedThreads: threads,
      settings: {
        intervalMinutes: settings.intervalMinutes,
        enabled: settings.enabled,
        pausedPlatforms: settings.pausedPlatforms,
        maxThreadDrills: settings.maxThreadDrills,
        visionDisabledPlatforms: settings.visionDisabledPlatforms,
      },
    },
    { headers: CORS }
  );
}
