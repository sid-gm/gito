import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { threadsFilters } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("companyId");

  const rows = await db
    .select()
    .from(threadsFilters)
    .where(companyId ? eq(threadsFilters.companyId, companyId) : undefined)
    .orderBy(threadsFilters.createdAt);

  return NextResponse.json(rows);
}

const addSchema = z.object({
  filterType: z.enum(["keyword", "user"]),
  value: z.string().min(1).max(100),
  companyId: z.string().uuid().optional(),
});

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = addSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid filter" }, { status: 400 });
  }

  const { filterType, value, companyId } = parsed.data;

  try {
    const [row] = await db
      .insert(threadsFilters)
      .values({ filterType, value, companyId: companyId ?? null })
      .onConflictDoNothing()
      .returning();
    return NextResponse.json(row ?? { filterType, value }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Failed to add filter" }, { status: 500 });
  }
}
