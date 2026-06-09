import { NextRequest, NextResponse } from "next/server";
import { linkNewsForAllEntities, linkNewsForEntity } from "@/lib/ai/link-news";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const entityId = req.nextUrl.searchParams.get("entityId");
    const result = entityId
      ? await linkNewsForEntity(entityId, 20)
      : await linkNewsForAllEntities(20);
    console.log(
      `[run/link-news] processed ${result.clustersProcessed} clusters, created ${result.linksCreated} links`
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[run/link-news]", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
