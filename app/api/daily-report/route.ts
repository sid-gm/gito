import { NextResponse } from "next/server";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { clusters, clusterItems, ingestedItems, trackedEntities, companies } from "@/lib/db/schema";

const TZ = "America/Los_Angeles";

function getTzAbbr(d: Date): string {
  return (
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "short" })
      .formatToParts(d)
      .find((p) => p.type === "timeZoneName")?.value ?? "PT"
  );
}

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

function pacificMidnight(d: Date): Date {
  const p = getPacificParts(d);
  // Build a UTC Date that represents midnight Pacific on this calendar day
  const utcMidnightNaive = Date.UTC(p.year, p.month - 1, p.day);
  const offsetMs = d.getTime() - new Date(d.toLocaleDateString("en-CA", { timeZone: TZ }) + "T00:00:00").getTime();
  return new Date(utcMidnightNaive + offsetMs);
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: TZ });
}

function getDayName(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "short", timeZone: TZ });
}

function formatFirstSeen(firstSeenAt: Date, todayStart: Date, tz: string): string {
  if (firstSeenAt < todayStart) {
    const daysAgo = Math.floor((todayStart.getTime() - firstSeenAt.getTime()) / 86400000);
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

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("companyId");
  if (!companyId) return NextResponse.json({ error: "companyId required" }, { status: 400 });

  const now = new Date();
  const tz = getTzAbbr(now);
  const todayStart = pacificMidnight(now);
  const currentHour = getPacificParts(now).hour;

  const [company] = await db.select({ name: companies.name }).from(companies).where(eq(companies.id, companyId));

  const entityRows = await db.select({ id: trackedEntities.id }).from(trackedEntities).where(eq(trackedEntities.companyId, companyId));
  const entityIds = entityRows.map((e) => e.id);

  const empty = {
    date: formatDate(now),
    day: getDayName(now),
    tz,
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
  const positions = computePositions(topN);

  const result = clusterRows.slice(0, topN).map((c, i) => {
    const items = itemsByCluster.get(c.id) ?? [];
    const platforms = [...(platformsByCluster.get(c.id) ?? new Set())];

    const baseCount = items.filter((it) => it.createdAt < todayStart).length;
    const todayItems = items.filter((it) => it.createdAt >= todayStart);

    const hourCounts = new Map<number, number>();
    for (const it of todayItems) {
      const h = getPacificParts(it.createdAt).hour;
      hourCounts.set(h, (hourCounts.get(h) ?? 0) + 1);
    }

    const hourly: number[] = [];
    let cumulative = baseCount;
    for (let h = 0; h < 24; h++) {
      cumulative += hourCounts.get(h) ?? 0;
      hourly.push(cumulative);
    }

    const displayItems = items.slice(0, 12).map((it) => {
      const beforeToday = it.createdAt < todayStart;
      const time = beforeToday
        ? `${Math.floor((todayStart.getTime() - it.createdAt.getTime()) / 86400000)}d ago`
        : (() => { const p = getPacificParts(it.createdAt); return `${p.hour.toString().padStart(2, "0")}:${p.minute.toString().padStart(2, "0")}`; })();
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
      firstSeen: formatFirstSeen(c.firstSeenAt, todayStart, tz),
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
    tz,
    company: company?.name ?? "—",
    currentHour,
    clusters: result,
  });
}
