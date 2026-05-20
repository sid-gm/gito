import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { clusterReports } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const companyId = req.nextUrl.searchParams.get("companyId");
  if (!companyId)
    return NextResponse.json({ error: "companyId required" }, { status: 400 });

  const reports = await db
    .select({
      id: clusterReports.id,
      clusterId: clusterReports.clusterId,
      clusterLabel: clusterReports.clusterLabel,
      companyName: clusterReports.companyName,
      generatedAt: clusterReports.generatedAt,
    })
    .from(clusterReports)
    .where(eq(clusterReports.companyId, companyId))
    .orderBy(desc(clusterReports.generatedAt));

  return NextResponse.json(reports);
}
