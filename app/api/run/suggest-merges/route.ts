import { NextRequest, NextResponse } from "next/server";
import { suggestMergesForAllEntities, suggestMergesForEntity, markStaleSuggestions } from "@/lib/ai/merge-suggestions";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const entityId = req.nextUrl.searchParams.get("entityId");
    if (entityId) {
      const staled = await markStaleSuggestions();
      const suggested = await suggestMergesForEntity(entityId);
      return NextResponse.json({ ok: true, suggested, staled });
    }
    const result = await suggestMergesForAllEntities();
    console.log(`[run/suggest-merges] suggested ${result.suggested}, staled ${result.staled}`);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[run/suggest-merges]", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
