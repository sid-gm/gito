import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { collectRuns, collectRunEvents } from "@/lib/db/schema";
import { verifyExtensionKey } from "@/lib/extension-auth";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

const startSchema = z.object({
  action: z.literal("start"),
  id: z.string().uuid().optional(), // extension may pre-generate the run id
  triggeredBy: z.enum(["auto", "manual"]),
});

const eventSchema = z.object({
  action: z.literal("event"),
  runId: z.string().uuid(),
  platform: z.enum(["twitter", "threads", "reddit", "instagram", "facebook", "linkedin", "news", "manual"]),
  sourceKind: z
    .enum(["keyword_search", "subreddit_new", "subreddit_hot", "tracked_thread", "profile", "manual", "rss"])
    .nullish(),
  sourceRef: z.string().nullish(),
  status: z.enum(["ok", "zero_results", "http_403", "logged_out", "checkpoint", "vision_fallback", "error"]),
  detail: z.string().nullish(),
  itemsCount: z.number().int().min(0).optional(),
});

const finalizeSchema = z.object({
  action: z.literal("finalize"),
  runId: z.string().uuid(),
  status: z.enum(["ok", "partial", "failed"]).optional(),
  itemsCollected: z.number().int().min(0),
  itemsInserted: z.number().int().min(0),
});

const bodySchema = z.discriminatedUnion("action", [startSchema, eventSchema, finalizeSchema]);

export async function POST(req: Request) {
  const companyId = await verifyExtensionKey(req);
  if (!companyId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: CORS });
  }

  let raw: unknown;
  try { raw = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: CORS });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400, headers: CORS });
  }
  const body = parsed.data;

  if (body.action === "start") {
    const [run] = await db
      .insert(collectRuns)
      .values({
        ...(body.id ? { id: body.id } : {}),
        companyId,
        triggeredBy: body.triggeredBy,
      })
      .onConflictDoNothing({ target: collectRuns.id })
      .returning({ id: collectRuns.id });
    return NextResponse.json({ runId: run?.id ?? body.id }, { status: 201, headers: CORS });
  }

  // Both event and finalize must target a run owned by this company
  const [run] = await db
    .select({ id: collectRuns.id })
    .from(collectRuns)
    .where(and(eq(collectRuns.id, body.runId), eq(collectRuns.companyId, companyId)));
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404, headers: CORS });
  }

  if (body.action === "event") {
    await db.insert(collectRunEvents).values({
      runId: body.runId,
      platform: body.platform,
      sourceKind: body.sourceKind ?? null,
      sourceRef: body.sourceRef ?? null,
      status: body.status,
      detail: body.detail ?? null,
      itemsCount: body.itemsCount ?? 0,
    });
    return NextResponse.json({ ok: true }, { headers: CORS });
  }

  // finalize — derive status from events unless the extension supplied one
  let status = body.status;
  if (!status) {
    const events = await db
      .select({ status: collectRunEvents.status })
      .from(collectRunEvents)
      .where(eq(collectRunEvents.runId, body.runId));
    const bad = events.filter((e) => ["http_403", "logged_out", "checkpoint", "error"].includes(e.status)).length;
    status = bad === 0 ? "ok" : bad === events.length && events.length > 0 ? "failed" : "partial";
  }

  await db
    .update(collectRuns)
    .set({
      finishedAt: new Date(),
      status,
      itemsCollected: body.itemsCollected,
      itemsInserted: body.itemsInserted,
    })
    .where(eq(collectRuns.id, body.runId));

  return NextResponse.json({ ok: true, status }, { headers: CORS });
}

// Recent runs with their events — powers the popup status surface
export async function GET(req: Request) {
  const companyId = await verifyExtensionKey(req);
  if (!companyId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: CORS });
  }

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit")) || 20, 50);

  const runs = await db
    .select()
    .from(collectRuns)
    .where(eq(collectRuns.companyId, companyId))
    .orderBy(desc(collectRuns.startedAt))
    .limit(limit);

  if (runs.length === 0) return NextResponse.json([], { headers: CORS });

  const events = await db
    .select()
    .from(collectRunEvents)
    .where(inArray(collectRunEvents.runId, runs.map((r) => r.id)))
    .orderBy(collectRunEvents.at);

  const eventsByRun = new Map<string, typeof events>();
  for (const e of events) {
    if (!eventsByRun.has(e.runId)) eventsByRun.set(e.runId, []);
    eventsByRun.get(e.runId)!.push(e);
  }

  return NextResponse.json(
    runs.map((run) => ({ ...run, events: eventsByRun.get(run.id) ?? [] })),
    { headers: CORS }
  );
}
