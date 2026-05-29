import { NextResponse } from "next/server";
import { getAllEntities, upsertItems } from "@/lib/collectors/ingest";
import { collectThreads } from "@/lib/collectors/threads";
import { db } from "@/lib/db";
import { threadsFilters } from "@/lib/db/schema";

export async function POST() {
  const [entities, filters] = await Promise.all([
    getAllEntities(),
    db.select().from(threadsFilters),
  ]);

  if (filters.length === 0) {
    return NextResponse.json({ ok: true, inserted: 0 });
  }

  try {
    const items = await collectThreads(filters, entities);
    const inserted = await upsertItems(items);
    return NextResponse.json({ ok: true, inserted });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
