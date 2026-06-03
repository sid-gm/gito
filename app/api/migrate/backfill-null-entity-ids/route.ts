import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ingestedItems, trackedEntities } from "@/lib/db/schema";
import { eq, isNull, and } from "drizzle-orm";
import { z } from "zod";

const schema = z.object({
  entityId: z.string().uuid(),
});

// POST /api/migrate/backfill-null-entity-ids
// Assigns a given entityId to all ingested_items rows that have entityId = NULL
// and whose platform/externalId matches the company owning that entity.
// Since null-entityId items have no company signal, all nulls are updated.
export async function POST(req: Request) {
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { entityId } = parsed.data;

  // Verify entity exists
  const [entity] = await db
    .select({ id: trackedEntities.id, label: trackedEntities.label })
    .from(trackedEntities)
    .where(eq(trackedEntities.id, entityId))
    .limit(1);

  if (!entity) {
    return NextResponse.json({ error: "Entity not found" }, { status: 404 });
  }

  const result = await db
    .update(ingestedItems)
    .set({ entityId })
    .where(isNull(ingestedItems.entityId))
    .returning({ id: ingestedItems.id });

  return NextResponse.json({ ok: true, updated: result.length, entityLabel: entity.label });
}
