import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  collectRuns,
  collectRunEvents,
  sourceHealth,
  rssFeeds,
  collectSettings,
  items,
} from "@/lib/db/schema";
import { and, desc, eq, inArray, max, count } from "drizzle-orm";

// Sources view: extension per-platform collection health + RSS feed health
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("companyId");
  if (!companyId) {
    return NextResponse.json({ error: "companyId required" }, { status: 400 });
  }

  const runLimit = Math.min(Number(searchParams.get("runs")) || 20, 50);

  const [runs, health, feeds, feedStats, [settings]] = await Promise.all([
    db
      .select()
      .from(collectRuns)
      .where(eq(collectRuns.companyId, companyId))
      .orderBy(desc(collectRuns.startedAt))
      .limit(runLimit),
    db.select().from(sourceHealth).where(eq(sourceHealth.companyId, companyId)),
    db.select().from(rssFeeds).where(eq(rssFeeds.companyId, companyId)).orderBy(rssFeeds.createdAt),
    db
      .select({
        feedId: items.sourceRef,
        itemCount: count(),
        lastItemAt: max(items.createdAt),
      })
      .from(items)
      .where(and(eq(items.companyId, companyId), eq(items.sourceKind, "rss")))
      .groupBy(items.sourceRef),
    db.select().from(collectSettings).where(eq(collectSettings.companyId, companyId)),
  ]);

  const events =
    runs.length > 0
      ? await db
          .select()
          .from(collectRunEvents)
          .where(inArray(collectRunEvents.runId, runs.map((r) => r.id)))
          .orderBy(collectRunEvents.at)
      : [];

  const eventsByRun = new Map<string, typeof events>();
  for (const e of events) {
    if (!eventsByRun.has(e.runId)) eventsByRun.set(e.runId, []);
    eventsByRun.get(e.runId)!.push(e);
  }

  // Platforms surviving on OCR are the early-warning sign selectors need fixing
  const visionFallbacks = events.filter((e) => e.status === "vision_fallback").length;

  const statsByFeed = new Map(feedStats.map((s) => [s.feedId, s]));

  return NextResponse.json({
    runs: runs.map((run) => ({ ...run, events: eventsByRun.get(run.id) ?? [] })),
    health,
    visionFallbacksInWindow: visionFallbacks,
    feeds: feeds.map((f) => ({
      ...f,
      itemCount: statsByFeed.get(f.id)?.itemCount ?? 0,
      lastItemAt: statsByFeed.get(f.id)?.lastItemAt ?? null,
    })),
    settings: settings ?? null,
  });
}
