import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { trackedEntities } from "@/lib/db/schema";
import { asc, eq, and, SQL } from "drizzle-orm";
import { z } from "zod";

const createSchema = z.object({
  label: z.string().min(1),
  queryString: z.string().min(1),
  entityType: z.enum(["keyword", "executive", "product"]),
  companyId: z.string().uuid(),
});

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("companyId");

  const conditions: SQL[] = [];
  if (companyId) conditions.push(eq(trackedEntities.companyId, companyId));

  try {
    const entities = await db
      .select()
      .from(trackedEntities)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(trackedEntities.createdAt));
    return NextResponse.json(entities);
  } catch (err) {
    console.error("[GET /api/entities]", err);
    return NextResponse.json({ error: "Failed to load entities" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { label, queryString, entityType, companyId } = parsed.data;
  try {
    const [entity] = await db
      .insert(trackedEntities)
      .values({ label, queryString, entityType, companyId })
      .returning();
    return NextResponse.json(entity, { status: 201 });
  } catch (err) {
    console.error("[POST /api/entities]", err);
    return NextResponse.json({ error: "Failed to save entity" }, { status: 500 });
  }
}
