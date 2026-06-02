import { NextResponse } from "next/server";
import { collectAndIngestRedditRss } from "@/lib/collectors/reddit-rss-ingest";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as { companyId?: string };

  if (!body.companyId) {
    return NextResponse.json({ error: "companyId required" }, { status: 400 });
  }

  console.log(`[poll/reddit-rss] manual poll companyId=${body.companyId}`);
  const inserted = await collectAndIngestRedditRss(body.companyId);
  console.log(`[poll/reddit-rss] inserted=${inserted}`);
  return NextResponse.json({ ok: true, inserted });
}
