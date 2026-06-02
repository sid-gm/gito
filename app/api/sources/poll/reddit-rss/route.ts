import { NextResponse } from "next/server";
import { collectAndIngestRedditRss } from "@/lib/collectors/reddit-rss-ingest";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as { companyId?: string };

  if (!body.companyId) {
    return NextResponse.json({ error: "companyId required" }, { status: 400 });
  }

  const inserted = await collectAndIngestRedditRss(body.companyId);
  return NextResponse.json({ ok: true, inserted });
}
