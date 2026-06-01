import { NextResponse } from "next/server";
import { and, eq, isNull, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { ingestedItems } from "@/lib/db/schema";
import { embedAll } from "@/lib/ai/embed";

const DB_CONCURRENCY = 20;

export async function POST() {
  const pending = await db
    .select({ id: ingestedItems.id, title: ingestedItems.title, body: ingestedItems.body })
    .from(ingestedItems)
    .where(and(isNull(ingestedItems.embedding), ne(ingestedItems.platform, "google_alerts")));

  const embeddable = pending.filter((item) => {
    const text = [item.title, item.body].filter(Boolean).join(" ").trim();
    return text.length > 0;
  });

  if (embeddable.length === 0) {
    return NextResponse.json({ ok: true, embedded: 0, skipped: pending.length });
  }

  const texts = embeddable.map((item) =>
    [item.title, item.body].filter(Boolean).join(" ").trim()
  );

  try {
    const embeddings = await embedAll(texts);

    for (let i = 0; i < embeddable.length; i += DB_CONCURRENCY) {
      await Promise.all(
        embeddable.slice(i, i + DB_CONCURRENCY).map((item, j) =>
          db
            .update(ingestedItems)
            .set({ embedding: embeddings[i + j] })
            .where(eq(ingestedItems.id, item.id))
        )
      );
    }

    console.log(`[run/embed] embedded ${embeddable.length}, skipped ${pending.length - embeddable.length}`);
    return NextResponse.json({
      ok: true,
      embedded: embeddable.length,
      skipped: pending.length - embeddable.length,
    });
  } catch (err) {
    console.error("[run/embed]", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
