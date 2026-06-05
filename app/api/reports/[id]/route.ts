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

  const { snapshotData, generatedAt, id: reportId, clusterId, clusterLabel, companyName, companyId, analystSummary } = rows[0];

  return NextResponse.json({
    reportId,
    clusterId,
    clusterLabel,
    companyName,
    companyId,
    generatedAt: generatedAt.toISOString(),
    analystSummary: analystSummary ?? null,
    ...(snapshotData as object),
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json() as { analystSummary?: string };

  if (typeof body.analystSummary !== "string")
    return NextResponse.json({ error: "analystSummary required" }, { status: 400 });

  const rows = await db
    .update(clusterReports)
    .set({ analystSummary: body.analystSummary })
    .where(eq(clusterReports.id, id))
    .returning({ id: clusterReports.id });

  if (!rows.length)
    return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const rows = await db
    .delete(clusterReports)
    .where(eq(clusterReports.id, id))
    .returning({ id: clusterReports.id });

  if (!rows.length)
    return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
