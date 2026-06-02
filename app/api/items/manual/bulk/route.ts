import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { trackedEntities } from "@/lib/db/schema";
import type { NewIngestedItem } from "@/lib/db/schema";
import { upsertItems } from "@/lib/collectors/ingest";
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
  const safeDate = (s: string | undefined): Date => {
    if (!s) return now;
    const d = new Date(s);
    return isNaN(d.getTime()) ? now : d;
  };

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
      publishedAt: safeDate(item.publishedAt),
      entityId: matchedEntityId,
      subtype: item.subtype ?? "thread_comment",
      rawJson: item.score !== undefined ? { score: item.score } : null,
    };
  });

  const inserted = await upsertItems(toInsert);

  return NextResponse.json({ inserted });
}
