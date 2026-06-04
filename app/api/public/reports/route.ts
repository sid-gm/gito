import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { clusterReports } from "@/lib/db/schema";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("companyId");

  if (!companyId) {
    return NextResponse.json({ error: "companyId required" }, { status: 400 });
  }

  const rows = await db
    .select({
      id: clusterReports.id,
      clusterLabel: clusterReports.clusterLabel,
      companyName: clusterReports.companyName,
      generatedAt: clusterReports.generatedAt,
    })
    .from(clusterReports)
    .where(eq(clusterReports.companyId, companyId))
    .orderBy(desc(clusterReports.generatedAt))
    .limit(20);

  return NextResponse.json({
    reports: rows.map((r) => ({
      id: r.id,
      clusterLabel: r.clusterLabel ?? "Untitled report",
      companyName: r.companyName ?? null,
      generatedAt: r.generatedAt.toISOString(),
    })),
  });
}
