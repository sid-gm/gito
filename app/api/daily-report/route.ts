import { NextResponse } from "next/server";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { clusters, clusterItems, ingestedItems, trackedEntities, companies } from "@/lib/db/schema";

// Bubble positions (SVG viewBox 1080×640) — pre-placed for 1–8 clusters
const BUBBLE_PRESETS: Array<Array<{ x: number; y: number }>> = [
  [{ x: 540, y: 320 }],
  [{ x: 350, y: 300 }, { x: 730, y: 340 }],
  [{ x: 540, y: 160 }, { x: 280, y: 480 }, { x: 800, y: 440 }],
  [{ x: 360, y: 200 }, { x: 760, y: 180 }, { x: 820, y: 500 }, { x: 280, y: 520 }],
  [{ x: 410, y: 480 }, { x: 800, y: 245 }, { x: 870, y: 660 }, { x: 220, y: 760 }, { x: 180, y: 230 }],
  [{ x: 540, y: 160 }, { x: 820, y: 240 }, { x: 940, y: 480 }, { x: 700, y: 680 }, { x: 260, y: 680 }, { x: 160, y: 380 }],
  [{ x: 540, y: 160 }, { x: 800, y: 220 }, { x: 950, y: 420 }, { x: 870, y: 620 }, { x: 550, y: 720 }, { x: 200, y: 640 }, { x: 170, y: 360 }],
  [{ x: 540, y: 150 }, { x: 780, y: 220 }, { x: 950, y: 400 }, { x: 900, y: 580 }, { x: 650, y: 700 }, { x: 340, y: 700 }, { x: 160, y: 540 }, { x: 180, y: 310 }],
];

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function getDayName(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
}

function formatFirstSeen(firstSeenAt: Date, todayStart: Date): string {
  if (firstSeenAt < todayStart) {
    const daysAgo = Math.floor((todayStart.getTime() - firstSeenAt.getTime()) / 86400000);
    if (daysAgo === 1) return "yesterday";
    return `${daysAgo}d ago`;
  }
  const h = firstSeenAt.getUTCHours().toString().padStart(2, "0");
  const m = firstSeenAt.getUTCMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("companyId");
  if (!companyId) return NextResponse.json({ error: "companyId required" }, { status: 400 });

  const now = new Date();
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const currentHour = now.getUTCHours();

  const [company] = await db.select({ name: companies.name }).from(companies).where(eq(companies.id, companyId));

  const entityRows = await db.select({ id: trackedEntities.id }).from(trackedEntities).where(eq(trackedEntities.companyId, companyId));
  const entityIds = entityRows.map((e) => e.id);

  const empty = {
    date: formatDate(now),
    day: getDayName(now),
    tz: "UTC",
    company: company?.name ?? "—",
    currentHour,
    clusters: [],
  };

  if (entityIds.length === 0) return NextResponse.json(empty);

  const clusterRows = await db
    .select({
      id: clusters.id,
      label: clusters.label,
      narrativeStage: clusters.narrativeStage,
      velocity24h: clusters.velocity24h,
      firstSeenAt: clusters.firstSeenAt,
      sentimentScore: clusters.sentimentScore,
      itemCount: clusters.itemCount,
    })
    .from(clusters)
    .where(and(isNull(clusters.archivedAt), inArray(clusters.entityId, entityIds)))
    .orderBy(desc(clusters.itemCount));

  if (clusterRows.length === 0) return NextResponse.json(empty);

  const clusterIds = clusterRows.map((c) => c.id);

  const allItems = await db
    .select({
      clusterId: clusterItems.clusterId,
      createdAt: ingestedItems.createdAt,
      platform: ingestedItems.platform,
      title: ingestedItems.title,
      author: ingestedItems.author,
    })
    .from(clusterItems)
    .innerJoin(ingestedItems, eq(clusterItems.itemId, ingestedItems.id))
    .where(inArray(clusterItems.clusterId, clusterIds))
    .orderBy(desc(ingestedItems.createdAt));

  // Group by cluster, compute hourly cumulative counts + collect items
  type ItemRow = { platform: string; title: string | null; author: string | null; createdAt: Date };
  const itemsByCluster = new Map<string, ItemRow[]>();
  const platformsByCluster = new Map<string, Set<string>>();

  for (const row of allItems) {
    const cid = row.clusterId;
    if (!itemsByCluster.has(cid)) itemsByCluster.set(cid, []);
    if (!platformsByCluster.has(cid)) platformsByCluster.set(cid, new Set());
    platformsByCluster.get(cid)!.add(row.platform);
    itemsByCluster.get(cid)!.push({ platform: row.platform, title: row.title, author: row.author, createdAt: row.createdAt });
  }

  const topN = Math.min(clusterRows.length, 8);
  const positions = BUBBLE_PRESETS[topN - 1] ?? BUBBLE_PRESETS[0];

  const result = clusterRows.slice(0, topN).map((c, i) => {
    const items = itemsByCluster.get(c.id) ?? [];
    const platforms = [...(platformsByCluster.get(c.id) ?? new Set())];

    // Compute hourly cumulative counts
    const baseCount = items.filter((it) => it.createdAt < todayStart).length;
    const todayItems = items.filter((it) => it.createdAt >= todayStart);

    const hourCounts = new Map<number, number>();
    for (const it of todayItems) {
      const h = it.createdAt.getUTCHours();
      hourCounts.set(h, (hourCounts.get(h) ?? 0) + 1);
    }

    const hourly: number[] = [];
    let cumulative = baseCount;
    for (let h = 0; h < 24; h++) {
      cumulative += hourCounts.get(h) ?? 0;
      hourly.push(cumulative);
    }

    // Top items for the detail panel (most recent 12)
    const displayItems = items.slice(0, 12).map((it) => {
      const d = it.createdAt;
      const beforeToday = d < todayStart;
      const time = beforeToday
        ? `${Math.floor((todayStart.getTime() - d.getTime()) / 86400000)}d ago`
        : `${d.getUTCHours().toString().padStart(2, "0")}:${d.getUTCMinutes().toString().padStart(2, "0")}`;
      return {
        platform: it.platform,
        title: it.title ?? "—",
        time,
        author: it.author ?? "—",
      };
    });

    return {
      id: c.id,
      label: c.label ?? `Cluster ${i + 1}`,
      short: (c.label ?? `Cluster ${i + 1}`).split(" ").slice(0, 3).join(" "),
      stage: c.narrativeStage ?? "relaxed",
      velocity: c.velocity24h ?? 0,
      firstSeen: formatFirstSeen(c.firstSeenAt, todayStart),
      platforms,
      x: positions[i]?.x ?? 540,
      y: positions[i]?.y ?? 320,
      hourly,
      sentiment: c.sentimentScore ?? 0,
      items: displayItems,
    };
  });

  return NextResponse.json({
    date: formatDate(now),
    day: getDayName(now),
    tz: "UTC",
    company: company?.name ?? "—",
    currentHour,
    clusters: result,
  });
}
