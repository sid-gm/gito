import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { clusterReports } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const rows = await db
    .select()
    .from(clusterReports)
    .where(eq(clusterReports.id, id))
    .limit(1);

  if (!rows.length)
    return NextResponse.json({ error: "not found" }, { status: 404 });

  const { snapshotData, generatedAt, id: reportId, clusterId, clusterLabel, companyName, companyId } = rows[0];

  return NextResponse.json({
    reportId,
    clusterId,
    clusterLabel,
    companyName,
    companyId,
    generatedAt: generatedAt.toISOString(),
    ...(snapshotData as object),
  });
}
