import { NextResponse } from "next/server";
import { and, eq, isNull, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { ingestedItems } from "@/lib/db/schema";
import { verifyCronSecret } from "@/lib/cron-auth";
import { embedText } from "@/lib/ai/embed";

const BATCH_SIZE = 50;

export async function GET(req: Request) {
  const authError = verifyCronSecret(req);
  if (authError) return authError;

  const pending = await db
    .select({
      id: ingestedItems.id,
      title: ingestedItems.title,
      body: ingestedItems.body,
    })
    .from(ingestedItems)
    .where(and(isNull(ingestedItems.embedding), ne(ingestedItems.platform, "google_alerts")))
    .limit(BATCH_SIZE);

  let embedded = 0;
  for (const item of pending) {
    const text = [item.title, item.body].filter(Boolean).join(" ").trim();
    if (!text) continue;
    try {
      const embedding = await embedText(text);
      await db
        .update(ingestedItems)
        .set({ embedding })
        .where(eq(ingestedItems.id, item.id));
      embedded++;
    } catch (err) {
      console.error(`[embed] item ${item.id}:`, err);
    }
  }

  return NextResponse.json({ ok: true, embedded });
}
