import { NextRequest, NextResponse } from "next/server";
import { buildDailyBrief } from "@/lib/ai/daily-brief";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const companyId = req.nextUrl.searchParams.get("companyId");
  if (!companyId) return NextResponse.json({ error: "companyId required" }, { status: 400 });

  const date = req.nextUrl.searchParams.get("date") ?? undefined;
  const force = req.nextUrl.searchParams.get("force") === "true";

  try {
    const result = await buildDailyBrief(companyId, date, force);
    console.log(`[run/daily-brief] company ${companyId}:`, result);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[run/daily-brief]", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
