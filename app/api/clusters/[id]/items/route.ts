import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { clusterItems, clusterMerges, clusterPeriodNarratives, ingestedItems } from "@/lib/db/schema";

function dedupeItems<T extends { externalId: string | null; url: string | null; title: string | null; similarity: number }>(items: T[]): T[] {
  const seen = new Map<string, T>();
  for (const item of items) {
    // externalId is item-unique (e.g. thread comments share URL but differ by externalId)
    const key = item.externalId ?? item.url ?? item.title ?? "";
    if (!key) continue;
    const prev = seen.get(key);
    if (!prev || item.similarity > prev.similarity) seen.set(key, item);
  }
  return [...seen.values()];
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const rows = await db
    .select({
      clusterId: clusterItems.clusterId,
      itemId: ingestedItems.id,
      similarity: clusterItems.similarity,
      itemSignal: clusterItems.itemSignal,
      signalReason: clusterItems.signalReason,
      analystSignal: clusterItems.analystSignal,
      analystNote: clusterItems.analystNote,
      analystFlag: clusterItems.analystFlag,
      mergeId: clusterItems.mergeId,
      title: ingestedItems.title,
      body: ingestedItems.body,
      url: ingestedItems.url,
      externalId: ingestedItems.externalId,
      platform: ingestedItems.platform,
      publishedAt: ingestedItems.publishedAt,
      ingestedAt: ingestedItems.createdAt,
    })
    .from(clusterItems)
    .innerJoin(ingestedItems, eq(clusterItems.itemId, ingestedItems.id))
    .where(eq(clusterItems.clusterId, id))
    .orderBy(desc(clusterItems.similarity));

  // Compute ingestion time range per mergeId before deduping
  const ingestedByMerge = new Map<string, { first: Date; last: Date }>();
  for (const row of rows) {
    if (!row.mergeId) continue;
    const d = row.ingestedAt;
    const existing = ingestedByMerge.get(row.mergeId);
    if (!existing) {
      ingestedByMerge.set(row.mergeId, { first: d, last: d });
    } else {
      if (d < existing.first) existing.first = d;
      if (d > existing.last) existing.last = d;
    }
  }

  const displayable = dedupeItems(
    rows.filter((i) => i.title || i.body || i.url).map((r) => ({ ...r, ingestedAt: r.ingestedAt.toISOString() }))
  );

  // Fetch merge records for this cluster (as surviving cluster)
  const mergeRows = await db
    .select()
    .from(clusterMerges)
    .where(eq(clusterMerges.survivingClusterId, id))
    .orderBy(clusterMerges.mergedAt);

  const merges: Record<string, {
    absorbedLabel: string | null;
    absorbedFirstSeenAt: string;
    absorbedLastSeenAt: string;
    absorbedItemCount: number;
    mergedAt: string;
    ingestedFirstAt: string;
    ingestedLastAt: string;
  }> = {};
  for (const m of mergeRows) {
    const ingestedRange = ingestedByMerge.get(m.id);
    merges[m.id] = {
      absorbedLabel: m.absorbedLabel,
      absorbedFirstSeenAt: m.absorbedFirstSeenAt.toISOString(),
      absorbedLastSeenAt: m.absorbedLastSeenAt.toISOString(),
      absorbedItemCount: m.absorbedItemCount,
      mergedAt: m.mergedAt.toISOString(),
      ingestedFirstAt: (ingestedRange?.first ?? m.mergedAt).toISOString(),
      ingestedLastAt: (ingestedRange?.last ?? m.mergedAt).toISOString(),
    };
  }

  const periodRows = await db
    .select({
      periodDate: clusterPeriodNarratives.periodDate,
      aiNarrative: clusterPeriodNarratives.aiNarrative,
      analystNarrative: clusterPeriodNarratives.analystNarrative,
    })
    .from(clusterPeriodNarratives)
    .where(eq(clusterPeriodNarratives.clusterId, id));

  const periodNarratives: Record<string, { aiNarrative: string | null; analystNarrative: string | null }> = {};
  for (const row of periodRows) {
    periodNarratives[row.periodDate] = { aiNarrative: row.aiNarrative, analystNarrative: row.analystNarrative };
  }

  return NextResponse.json({ items: displayable, merges, periodNarratives });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { itemId } = z.object({ itemId: z.string().uuid() }).parse(await req.json());
  await db.insert(clusterItems).values({
    clusterId: id,
    itemId,
    similarity: 1.0,
    itemSignal: "unclassified",
  }).onConflictDoNothing();

  return NextResponse.json({ ok: true }, { status: 201 });
}
