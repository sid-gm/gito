import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { companies, trackedEntities, trackedThreads, twitterHandles, redditSubreddits } from "@/lib/db/schema";
import { verifyExtensionKey } from "@/lib/extension-auth";
import { and, eq } from "drizzle-orm";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET(req: Request) {
  const companyId = await verifyExtensionKey(req);
  if (!companyId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: CORS });
  }

  const [company] = await db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(eq(companies.id, companyId));

  if (!company) {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: CORS });
  }

  const entities = await db
    .select({ id: trackedEntities.id, label: trackedEntities.label })
    .from(trackedEntities)
    .where(eq(trackedEntities.companyId, companyId))
    .orderBy(trackedEntities.label);

  const threads = await db
    .select({
      url: trackedThreads.postUrl,
      platform: trackedThreads.platform,
      externalId: trackedThreads.postExternalId,
    })
    .from(trackedThreads)
    .where(and(eq(trackedThreads.companyId, companyId), eq(trackedThreads.isActive, true)));

  const handles = await db
    .select({ handle: twitterHandles.handle })
    .from(twitterHandles)
    .where(eq(twitterHandles.companyId, companyId));

  const subreddits = await db
    .select({ subredditName: redditSubreddits.subredditName, keywordFilters: redditSubreddits.keywordFilters })
    .from(redditSubreddits)
    .where(eq(redditSubreddits.companyId, companyId));

  return NextResponse.json(
    {
      companyId: company.id,
      companyName: company.name,
      entities,
      trackedThreads: threads,
      twitterAccounts: handles.map((h) => h.handle),
      redditSubreddits: subreddits,
    },
    { headers: CORS }
  );
}
