import { NextRequest, NextResponse } from "next/server";
import { assignClustersToStorylines, refreshStaleLenses, refreshStorylineLens } from "@/lib/ai/storylines";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const storylineId = req.nextUrl.searchParams.get("storylineId");
    if (storylineId) {
      const refreshed = await refreshStorylineLens(storylineId);
      return NextResponse.json({ ok: true, refreshed });
    }
    const result = await assignClustersToStorylines(50);
    const lensesRefreshed = await refreshStaleLenses(20);
    console.log(
      `[run/assign-storylines] assigned ${result.assigned}, created ${result.created}, lenses ${lensesRefreshed}`
    );
    return NextResponse.json({ ok: true, ...result, lensesRefreshed });
  } catch (err) {
    console.error("[run/assign-storylines]", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
