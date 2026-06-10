import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { clusters, clusterPeriodNarratives } from "@/lib/db/schema";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { date, narrative } = await req.json();
  if (!date || typeof narrative !== "string") {
    return NextResponse.json({ error: "date and narrative required" }, { status: 400 });
  }

  const now = new Date();
  await db
    .insert(clusterPeriodNarratives)
    .values({ clusterId: id, periodDate: date, analystNarrative: narrative, updatedAt: now })
    .onConflictDoUpdate({
      target: [clusterPeriodNarratives.clusterId, clusterPeriodNarratives.periodDate],
      set: { analystNarrative: narrative, updatedAt: now },
    });

  await db
    .update(clusters)
    .set({ analystReviewedAt: now })
    .where(eq(clusters.id, id));

  return NextResponse.json({ ok: true, analystReviewedAt: now.toISOString() });
}
