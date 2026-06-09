import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { extensionCollectRuns, ingestedItems, trackedEntities } from "@/lib/db/schema";
import { verifyExtensionKey } from "@/lib/extension-auth";
import { desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

const postSchema = z.object({
  id:             z.string().uuid(),
  triggeredBy:    z.enum(["auto", "manual"]),
  ranAt:          z.string(),
  searchTerms:    z.array(z.string()),
  platforms:      z.array(z.string()),
  itemsCollected: z.number().int().min(0),
  itemsInserted:  z.number().int().min(0),
});

export async function POST(req: Request) {
  const companyId = await verifyExtensionKey(req);
  if (!companyId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: CORS });
  }

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: CORS });
  }

  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400, headers: CORS });
  }

  const { id, triggeredBy, ranAt, searchTerms, platforms, itemsCollected, itemsInserted } = parsed.data;

  await db
    .insert(extensionCollectRuns)
    .values({ id, companyId, triggeredBy, ranAt: new Date(ranAt), searchTerms, platforms, itemsCollected, itemsInserted })
    .onConflictDoUpdate({
      target: extensionCollectRuns.id,
      set: { itemsCollected, itemsInserted },
    });

  return NextResponse.json({ ok: true }, { headers: CORS });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("companyId");
  if (!companyId) {
    return NextResponse.json({ error: "companyId required" }, { status: 400 });
  }

  const runs = await db
    .select()
    .from(extensionCollectRuns)
    .where(eq(extensionCollectRuns.companyId, companyId))
    .orderBy(desc(extensionCollectRuns.ranAt))
    .limit(50);

  if (runs.length === 0) {
    return NextResponse.json([]);
  }

  const runIds = runs.map((r) => r.id);

  const items = await db
    .select({
      id:           ingestedItems.id,
      collectRunId: ingestedItems.collectRunId,
      platform:     ingestedItems.platform,
      url:          ingestedItems.url,
      title:        ingestedItems.title,
      body:         ingestedItems.body,
      author:       ingestedItems.author,
      publishedAt:  ingestedItems.publishedAt,
      createdAt:    ingestedItems.createdAt,
      entityId:     ingestedItems.entityId,
      entityLabel:  trackedEntities.label,
      subtype:      ingestedItems.subtype,
    })
    .from(ingestedItems)
    .leftJoin(trackedEntities, eq(ingestedItems.entityId, trackedEntities.id))
    .where(inArray(ingestedItems.collectRunId, runIds));

  const itemsByRun = new Map<string, typeof items>();
  for (const item of items) {
    if (!item.collectRunId) continue;
    if (!itemsByRun.has(item.collectRunId)) itemsByRun.set(item.collectRunId, []);
    itemsByRun.get(item.collectRunId)!.push(item);
  }

  return NextResponse.json(
    runs.map((run) => ({ ...run, items: itemsByRun.get(run.id) ?? [] }))
  );
}
