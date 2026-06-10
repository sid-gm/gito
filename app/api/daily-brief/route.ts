import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { dailyBriefs } from "@/lib/db/schema";
import { pacificDateKey } from "@/lib/pacific-time";

export async function GET(req: NextRequest) {
  const companyId = req.nextUrl.searchParams.get("companyId");
  if (!companyId) return NextResponse.json({ error: "companyId required" }, { status: 400 });

  const date = req.nextUrl.searchParams.get("date") ?? pacificDateKey(new Date());

  const brief = await db
    .select({
      id: dailyBriefs.id,
      periodDate: dailyBriefs.periodDate,
      snapshotData: dailyBriefs.snapshotData,
      generatedAt: dailyBriefs.generatedAt,
    })
    .from(dailyBriefs)
    .where(and(eq(dailyBriefs.companyId, companyId), eq(dailyBriefs.periodDate, date)))
    .then((rows) => rows[0]);

  if (!brief) return NextResponse.json({ brief: null }, { status: 404 });

  return NextResponse.json({
    brief: {
      ...brief,
      generatedAt: brief.generatedAt.toISOString(),
    },
  });
}
