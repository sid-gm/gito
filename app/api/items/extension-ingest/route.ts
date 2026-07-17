import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { items, collectKeywords, engagementSnapshots } from "@/lib/db/schema";
import type { NewItem } from "@/lib/db/schema";
import { verifyExtensionKey } from "@/lib/extension-auth";
import { cleanThreadsBody } from "@/lib/collectors/threads-text";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

const engagementSchema = z.object({
  likes: z.number().int().min(0).nullish(),
  replies: z.number().int().min(0).nullish(),
  reposts: z.number().int().min(0).nullish(),
  upvotes: z.number().int().min(0).nullish(),
  views: z.number().int().min(0).nullish(),
});

const itemSchema = z.object({
  platform: z.enum(["twitter", "threads", "reddit", "instagram", "facebook", "linkedin", "manual"]),
  kind: z.enum(["post", "comment"]),
  externalId: z.string().nullish(),
  url: z.string().nullish(),
  author: z.string().nullish(),
  title: z.string().nullish(), // real titles only (reddit); never body prefixes
  body: z.string().nullish(),
  publishedAt: z.string().nullish(),
  publishedAtPrecision: z.enum(["exact", "approx", "unknown"]).optional(),
  parentExternalId: z.string().nullish(),
  rootExternalId: z.string().nullish(),
  depth: z.number().int().min(0).nullish(),
  sourceKind: z.enum(["keyword_search", "subreddit_new", "subreddit_hot", "tracked_thread", "profile", "manual"]),
  sourceRef: z.string().nullish(),
  extractionMethod: z.enum(["dom", "vision"]).optional(),
  extractionConfidence: z.number().min(0).max(1).nullish(),
  engagement: engagementSchema.nullish(),
  topicId: z.string().uuid().nullish(),
});

const bodySchema = z.object({
  items: z.array(itemSchema).min(1).max(200),
  collectRunId: z.string().uuid().optional(),
});

// Content hash for items without a platform id (vision-extracted): stable
// across re-scrapes of the same rendered post.
function computeDedupeKey(platform: string, author: string | null | undefined, body: string | null | undefined): string | null {
  const text = (body ?? "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 120);
  if (!text) return null;
  return createHash("sha256")
    .update(`${platform}|${(author ?? "").toLowerCase().trim()}|${text}`)
    .digest("hex");
}

function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

type Engagement = z.infer<typeof engagementSchema>;

function hasEngagement(e: Engagement | null | undefined): e is Engagement {
  return !!e && [e.likes, e.replies, e.reposts, e.upvotes, e.views].some((v) => v != null);
}

export async function POST(req: Request) {
  const companyId = await verifyExtensionKey(req);
  if (!companyId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: CORS });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: CORS });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400, headers: CORS });
  }

  const { items: batch, collectRunId } = parsed.data;

  // Topic by provenance: keyword_search items inherit the owning topic of the
  // keyword that found them (replaces the old substring-match against labels).
  const keywordTerms = [...new Set(
    batch
      .filter((i) => i.sourceKind === "keyword_search" && i.sourceRef && !i.topicId)
      .map((i) => i.sourceRef!.toLowerCase())
  )];
  const termToTopic = new Map<string, string | null>();
  if (keywordTerms.length > 0) {
    const kws = await db
      .select({ term: collectKeywords.term, topicId: collectKeywords.topicId })
      .from(collectKeywords)
      .where(and(
        eq(collectKeywords.companyId, companyId),
        inArray(sql`lower(${collectKeywords.term})`, keywordTerms)
      ));
    for (const kw of kws) termToTopic.set(kw.term.toLowerCase(), kw.topicId);
  }

  const toRow = (i: z.infer<typeof itemSchema>): NewItem => {
    const publishedAt = parseDate(i.publishedAt);
    const externalId = i.externalId ?? null;
    // Threads bodies arrive wrapped in scraped UI chrome (Follow…More header +
    // Like…Share action bar) — strip it before hashing/storing. Reliable even
    // for older extension builds that still send raw text.
    const body =
      i.platform === "threads" ? cleanThreadsBody(i.body, i.author) || null : i.body ?? null;
    const dedupeKey = computeDedupeKey(i.platform, i.author, body);
    const rootExternalId = i.rootExternalId ?? null;
    const threadKey = rootExternalId
      ? `${i.platform}:${rootExternalId}`
      : i.kind === "post" && externalId
        ? `${i.platform}:${externalId}`
        : null;
    const topicId = i.topicId
      ?? (i.sourceKind === "keyword_search" && i.sourceRef
        ? termToTopic.get(i.sourceRef.toLowerCase()) ?? null
        : null);

    return {
      companyId,
      platform: i.platform,
      kind: i.kind,
      externalId,
      url: i.url ?? null,
      author: i.author ?? null,
      title: i.title ?? null,
      body,
      publishedAt,
      publishedAtPrecision: publishedAt ? (i.publishedAtPrecision ?? "exact") : "unknown",
      threadKey,
      depth: i.depth ?? null,
      topicId,
      sourceKind: i.sourceKind,
      sourceRef: i.sourceRef ?? null,
      collectRunId: collectRunId ?? null,
      extractionMethod: i.extractionMethod ?? "dom",
      extractionConfidence: i.extractionConfidence ?? null,
      dedupeKey,
      latestEngagement: hasEngagement(i.engagement)
        ? {
            likes: i.engagement.likes ?? undefined,
            replies: i.engagement.replies ?? undefined,
            reposts: i.engagement.reposts ?? undefined,
            upvotes: i.engagement.upvotes ?? undefined,
            views: i.engagement.views ?? undefined,
          }
        : null,
    };
  };

  const rows = batch.map(toRow);
  const withExternalId = rows.filter((r) => r.externalId);
  const withDedupeOnly = rows.filter((r) => !r.externalId && r.dedupeKey);
  const anonymous = rows.filter((r) => !r.externalId && !r.dedupeKey);

  let inserted = 0;
  let updated = 0;
  const idByExternalId = new Map<string, string>();
  const engagementTargets: Array<{ itemId: string; engagement: Engagement }> = [];

  // DOM re-scrapes of a known item refresh latest_engagement + add a snapshot
  // instead of being dropped silently.
  if (withExternalId.length > 0) {
    const returned = await db
      .insert(items)
      .values(withExternalId)
      .onConflictDoUpdate({
        target: [items.companyId, items.platform, items.externalId],
        set: {
          latestEngagement: sql`COALESCE(excluded.latest_engagement, ${items.latestEngagement})`,
        },
      })
      .returning({
        id: items.id,
        externalId: items.externalId,
        wasInserted: sql<boolean>`(xmax = 0)`,
      });

    for (const r of returned) {
      if (r.externalId) idByExternalId.set(r.externalId, r.id);
      if (r.wasInserted) inserted++;
      else updated++;
    }
    for (const row of withExternalId) {
      const id = row.externalId ? idByExternalId.get(row.externalId) : undefined;
      if (id && hasEngagement(row.latestEngagement as Engagement | null)) {
        engagementTargets.push({ itemId: id, engagement: row.latestEngagement as Engagement });
      }
    }

    // DOM wins over vision: absorb earlier vision rows of the same content
    const domKeys = [...new Set(withExternalId.map((r) => r.dedupeKey).filter((k): k is string => !!k))];
    if (domKeys.length > 0) {
      await db.delete(items).where(and(
        eq(items.companyId, companyId),
        isNull(items.externalId),
        inArray(items.dedupeKey, domKeys)
      ));
    }
  }

  // Vision items: no platform id, dedupe on the content hash (partial index)
  if (withDedupeOnly.length > 0) {
    const returned = await db
      .insert(items)
      .values(withDedupeOnly)
      .onConflictDoUpdate({
        target: [items.companyId, items.dedupeKey],
        targetWhere: sql`external_id IS NULL AND dedupe_key IS NOT NULL`,
        set: {
          latestEngagement: sql`COALESCE(excluded.latest_engagement, ${items.latestEngagement})`,
        },
      })
      .returning({ id: items.id, dedupeKey: items.dedupeKey, wasInserted: sql<boolean>`(xmax = 0)` });

    const idByKey = new Map(returned.map((r) => [r.dedupeKey!, r.id]));
    for (const r of returned) {
      if (r.wasInserted) inserted++;
      else updated++;
    }
    for (const row of withDedupeOnly) {
      const id = idByKey.get(row.dedupeKey!);
      if (id && hasEngagement(row.latestEngagement as Engagement | null)) {
        engagementTargets.push({ itemId: id, engagement: row.latestEngagement as Engagement });
      }
    }
  }

  if (anonymous.length > 0) {
    const returned = await db.insert(items).values(anonymous).returning({ id: items.id });
    inserted += returned.length;
  }

  if (engagementTargets.length > 0) {
    const capturedAt = new Date();
    await db
      .insert(engagementSnapshots)
      .values(engagementTargets.map((t) => ({
        itemId: t.itemId,
        capturedAt,
        likes: t.engagement.likes ?? null,
        replies: t.engagement.replies ?? null,
        reposts: t.engagement.reposts ?? null,
        upvotes: t.engagement.upvotes ?? null,
        views: t.engagement.views ?? null,
      })))
      .onConflictDoNothing();
  }

  // Structural threading: resolve parent/root external ids to row ids. Every
  // collector supplies these now (reddit thingid/postid, fb comment_id, x).
  const needsLinking = batch.filter((i) => i.externalId && (i.parentExternalId || i.rootExternalId));
  if (needsLinking.length > 0) {
    const toResolve = [...new Set(
      needsLinking.flatMap((i) => [i.externalId, i.parentExternalId, i.rootExternalId]).filter((x): x is string => !!x)
    )];
    const resolved = await db
      .select({ id: items.id, externalId: items.externalId })
      .from(items)
      .where(and(eq(items.companyId, companyId), inArray(items.externalId, toResolve)));
    const eidToId = new Map(resolved.map((r) => [r.externalId!, r.id]));

    for (const i of needsLinking) {
      const itemId = eidToId.get(i.externalId!);
      if (!itemId) continue;
      const parentId = i.parentExternalId ? eidToId.get(i.parentExternalId) ?? null : null;
      const rootPostId = i.rootExternalId ? eidToId.get(i.rootExternalId) ?? null : null;
      if (parentId || rootPostId) {
        await db
          .update(items)
          .set({ ...(parentId ? { parentId } : {}), ...(rootPostId ? { rootPostId } : {}) })
          .where(eq(items.id, itemId));
      }
    }
  }

  return NextResponse.json(
    { inserted, updated, total: batch.length },
    { headers: CORS }
  );
}
