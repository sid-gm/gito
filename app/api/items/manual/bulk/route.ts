import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ingestedItems, trackedEntities } from "@/lib/db/schema";
import type { NewIngestedItem } from "@/lib/db/schema";
import { upsertItems } from "@/lib/collectors/ingest";
import { embedText } from "@/lib/ai/embed";
import { eq } from "drizzle-orm";
import { z } from "zod";

const itemSchema = z.object({
  title: z.string().min(1),
  body: z.string().optional(),
  author: z.string().optional(),
  url: z.string().optional(),
  publishedAt: z.string().optional(),
  score: z.number().optional(),
  subtype: z.string().optional(),
  externalId: z.string().optional(),
});

const schema = z.object({
  items: z.array(itemSchema).min(1).max(500),
  entityId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
  matchEntities: z.boolean().optional().default(true),
});

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { items, entityId, companyId, matchEntities } = parsed.data;

  // Load entities for keyword matching if no explicit entityId provided
  let entities: { id: string; label: string }[] = [];
  if (matchEntities && !entityId && companyId) {
    entities = await db
      .select({ id: trackedEntities.id, label: trackedEntities.label })
      .from(trackedEntities)
      .where(eq(trackedEntities.companyId, companyId));
  }

  const now = new Date();
  const toInsert: NewIngestedItem[] = items.map((item) => {
    // Keyword-match against entities if no explicit entityId
    let matchedEntityId: string | null = entityId ?? null;
    if (!matchedEntityId && entities.length > 0) {
      const bodyLower = (item.body ?? "").toLowerCase();
      const titleLower = item.title.toLowerCase();
      const match = entities.find(
        (e) => titleLower.includes(e.label.toLowerCase()) || bodyLower.includes(e.label.toLowerCase())
      );
      matchedEntityId = match?.id ?? null;
    }

    return {
      platform: "manual" as const,
      externalId: item.externalId ?? null,
      url: item.url ?? null,
      title: item.title,
      body: item.body ?? null,
      author: item.author ?? null,
      publishedAt: item.publishedAt ? new Date(item.publishedAt) : now,
      entityId: matchedEntityId,
      subtype: item.subtype ?? "thread_comment",
      rawJson: item.score !== undefined ? { score: item.score } : null,
    };
  });

  const inserted = await upsertItems(toInsert);

  // Embed items async (non-blocking — fire and forget)
  void embedInserted(toInsert);

  return NextResponse.json({ inserted });
}

async function embedInserted(items: NewIngestedItem[]) {
  for (const item of items) {
    try {
      const text = [item.title, item.body].filter(Boolean).join("\n");
      if (!text.trim()) continue;
      const vec = await embedText(text);
      // Find the item by platform + externalId (or platform + title as fallback)
      const where = item.externalId
        ? { platform: item.platform, externalId: item.externalId }
        : null;
      if (!where) continue;
      const rows = await db
        .select({ id: ingestedItems.id })
        .from(ingestedItems)
        .where(eq(ingestedItems.externalId, item.externalId!))
        .limit(1);
      if (rows[0]) {
        await db.update(ingestedItems).set({ embedding: vec }).where(eq(ingestedItems.id, rows[0].id));
      }
    } catch {
      // embedding failure is non-fatal
    }
  }
}
