import { NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron-auth";
import { getAllEntities, upsertItems } from "@/lib/collectors/ingest";
import { collectThreads } from "@/lib/collectors/threads";
import { db } from "@/lib/db";
import { threadsFilters } from "@/lib/db/schema";

export async function GET(req: Request) {
  const authError = verifyCronSecret(req);
  if (authError) return authError;

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
    console.error("[Threads:cron]", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
