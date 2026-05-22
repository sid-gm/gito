import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { ingestedItems } from "@/lib/db/schema";
import { embedText } from "@/lib/ai/embed";
import { z } from "zod";

const schema = z.object({
  url: z.string().url().optional().or(z.literal("")),
  title: z.string().min(1),
  body: z.string().optional(),
  author: z.string().optional(),
  publishedAt: z.string().optional(),
  entityId: z.string().uuid().optional(),
});

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { url, title, body: itemBody, author, publishedAt, entityId } = parsed.data;

  const [item] = await db
    .insert(ingestedItems)
    .values({
      platform: "manual",
      externalId: null,
      url: url || null,
      title,
      body: itemBody || null,
      author: author || null,
      publishedAt: publishedAt ? new Date(publishedAt) : new Date(),
      entityId: entityId || null,
      rawJson: null,
    })
    .returning();

  try {
    const text = [title, itemBody].filter(Boolean).join("\n");
    const vec = await embedText(text);
    await db.update(ingestedItems).set({ embedding: vec }).where(eq(ingestedItems.id, item.id));
    item.embedding = vec;
  } catch (err) {
    console.error("[items/manual] embed failed, story saved without embedding:", err);
  }

  return NextResponse.json(item, { status: 201 });
}
