import { NextResponse } from "next/server";
import { and, desc, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { clusters, clusterItems, ingestedItems, trackedEntities, companies } from "@/lib/db/schema";

const TZ = "America/Los_Angeles";

function getPacificParts(d: Date) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  return {
    year: parseInt(parts.year),
    month: parseInt(parts.month),
    day: parseInt(parts.day),
    hour: parseInt(parts.hour === "24" ? "0" : parts.hour),
    minute: parseInt(parts.minute),
  };
}

function pacificMidnightFromStr(dateStr: string): Date {
  for (const utcHour of [7, 8]) {
    const candidate = new Date(`${dateStr}T${String(utcHour).padStart(2, "0")}:00:00.000Z`);
    if (
      candidate.toLocaleDateString("en-CA", { timeZone: TZ }) === dateStr &&
      getPacificParts(candidate).hour === 0
    ) {
      return candidate;
    }
  }
  return new Date(`${dateStr}T08:00:00.000Z`);
}

function getTzAbbr(d: Date): string {
  return (
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "short" })
      .formatToParts(d)
      .find((p) => p.type === "timeZoneName")?.value ?? "PT"
  );
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: TZ });
}

function getDayName(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "short", timeZone: TZ });
}

function formatFirstSeen(firstSeenAt: Date, dayStart: Date, tz: string): string {
  if (firstSeenAt < dayStart) {
    const daysAgo = Math.floor((dayStart.getTime() - firstSeenAt.getTime()) / 86400000);
    if (daysAgo === 1) return "yesterday";
    return `${daysAgo}d ago`;
  }
  const p = getPacificParts(firstSeenAt);
  return `${p.hour.toString().padStart(2, "0")}:${p.minute.toString().padStart(2, "0")} ${tz}`;
}

function computePositions(n: number): Array<{ x: number; y: number }> {
  if (n === 1) return [{ x: 540, y: 320 }];
  const cx = 540, cy = 320;
  const ringRadius = n <= 2 ? 200 : n <= 4 ? 210 : n <= 6 ? 240 : 260;
  return Array.from({ length: n }, (_, i) => {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    return {
      x: Math.round(cx + ringRadius * Math.cos(angle)),
      y: Math.round(cy + ringRadius * Math.sin(angle)),
    };
  });
}

async function fetchDayData(companyId: string, dateStr: string) {
  const now = new Date();
  const todayKey = now.toLocaleDateString("en-CA", { timeZone: TZ });
  const tz = getTzAbbr(now);
  const isToday = dateStr === todayKey;

  const dayStart = pacificMidnightFromStr(dateStr);
  const dayEnd = new Date(dayStart.getTime() + 86400000);
  const currentHour = isToday ? getPacificParts(now).hour : 23;

  const [company] = await db.select({ name: companies.name }).from(companies).where(eq(companies.id, companyId)).limit(1);
  const entityRows = await db.select({ id: trackedEntities.id }).from(trackedEntities).where(eq(trackedEntities.companyId, companyId));
  const entityIds = entityRows.map((e) => e.id);

  if (entityIds.length === 0) return null;

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

  if (clusterRows.length === 0) return null;

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
    .where(and(
      inArray(clusterItems.clusterId, clusterIds),
      gte(ingestedItems.createdAt, dayStart),
      lt(ingestedItems.createdAt, dayEnd),
    ))
    .orderBy(desc(ingestedItems.createdAt));

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

  const activeClusters = clusterRows.filter((c) => (itemsByCluster.get(c.id)?.length ?? 0) > 0);
  if (activeClusters.length === 0) return null;

  const topN = Math.min(activeClusters.length, 8);
  const positions = computePositions(topN);

  const clusterData = activeClusters.slice(0, topN).map((c, i) => {
    const items = itemsByCluster.get(c.id) ?? [];
    const platforms = [...(platformsByCluster.get(c.id) ?? new Set())];

    const hourCounts = new Map<number, number>();
    for (const it of items) {
      const h = getPacificParts(it.createdAt).hour;
      hourCounts.set(h, (hourCounts.get(h) ?? 0) + 1);
    }

    const hourly: number[] = [];
    let cumulative = 0;
    for (let h = 0; h < 24; h++) {
      cumulative += hourCounts.get(h) ?? 0;
      hourly.push(cumulative);
    }

    const displayItems = items.slice(0, 12).map((it) => {
      const p = getPacificParts(it.createdAt);
      return {
        platform: it.platform,
        title: it.title ?? "—",
        time: `${p.hour.toString().padStart(2, "0")}:${p.minute.toString().padStart(2, "0")}`,
        author: it.author ?? "—",
      };
    });

    return {
      id: c.id,
      label: c.label ?? `Cluster ${i + 1}`,
      short: (c.label ?? `Cluster ${i + 1}`).split(" ").slice(0, 3).join(" "),
      stage: c.narrativeStage ?? "relaxed",
      velocity: c.velocity24h ?? 0,
      firstSeen: formatFirstSeen(c.firstSeenAt, dayStart, tz),
      platforms,
      x: positions[i]?.x ?? 540,
      y: positions[i]?.y ?? 320,
      hourly,
      sentiment: c.sentimentScore ?? 0,
      items: displayItems,
    };
  });

  return {
    date: formatDate(dayStart),
    day: getDayName(dayStart),
    dateKey: dateStr,
    todayKey,
    tz,
    company: company?.name ?? "—",
    currentHour,
    generatedAt: now.toISOString(),
    clusters: clusterData,
  };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("companyId");

  if (!companyId) {
    return NextResponse.json({ error: "companyId required" }, { status: 400 });
  }

  const now = new Date();
  const todayKey = now.toLocaleDateString("en-CA", { timeZone: TZ });
  const yesterdayKey = new Date(now.getTime() - 86400000).toLocaleDateString("en-CA", { timeZone: TZ });

  let data = await fetchDayData(companyId, todayKey);
  if (!data) {
    data = await fetchDayData(companyId, yesterdayKey);
  }

  if (!data) {
    return NextResponse.json(
      { error: null, generatedAt: now.toISOString(), clusters: [] },
      {
        headers: { "Cache-Control": "s-maxage=3600, stale-while-revalidate=600" },
      }
    );
  }

  return NextResponse.json(data, {
    headers: { "Cache-Control": "s-maxage=3600, stale-while-revalidate=600" },
  });
}
