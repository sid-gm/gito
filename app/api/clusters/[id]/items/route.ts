import { NextResponse } from "next/server";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { clusterItems, clusterMerges, clusterPeriodNarratives, ingestedItems } from "@/lib/db/schema";

const EXPAND_THRESHOLD = 0.70;

function dedupeItems<T extends { url: string | null; title: string | null; similarity: number }>(items: T[]): T[] {
  const seen = new Map<string, T>();
  for (const item of items) {
    const key = item.url ?? item.title ?? "";
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

  // Auto-expand: find items similar to the newly added story and pull them in too
  let expandedBy = 0;
  try {
    const [source] = await db
      .select({ embedding: ingestedItems.embedding, entityId: ingestedItems.entityId })
      .from(ingestedItems)
      .where(eq(ingestedItems.id, itemId));

    if (source?.embedding && source?.entityId) {
      const vecStr = `[${source.embedding.join(",")}]`;
      const similar = await db.execute<{ item_id: string; similarity: number }>(
        sql`
          SELECT i.id AS item_id,
                 (1 - (i.embedding <=> ${vecStr}::vector))::float AS similarity
          FROM ingested_items i
          WHERE i.entity_id = ${source.entityId}
            AND i.embedding IS NOT NULL
            AND i.id != ${itemId}
            AND (1 - (i.embedding <=> ${vecStr}::vector)) >= ${EXPAND_THRESHOLD}
            AND NOT EXISTS (
              SELECT 1 FROM cluster_items ci
              WHERE ci.item_id = i.id AND ci.cluster_id = ${id}
            )
        `
      );

      if (similar.rows.length > 0) {
        const values = similar.rows.map((r) => ({
          clusterId: id,
          itemId: r.item_id,
          similarity: r.similarity,
          itemSignal: "unclassified" as const,
        }));
        const inserted = await db.insert(clusterItems).values(values).onConflictDoNothing().returning();
        expandedBy = inserted.length;
      }
    }
  } catch (err) {
    console.error("[clusters/items] auto-expand failed:", err);
  }

  return NextResponse.json({ ok: true, expandedBy }, { status: 201 });
}
