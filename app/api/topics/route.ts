import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { topics } from "@/lib/db/schema";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("companyId");
  if (!companyId) {
    return NextResponse.json({ error: "companyId required" }, { status: 400 });
  }

  const rows = await db
    .select()
    .from(topics)
    .where(eq(topics.companyId, companyId))
    .orderBy(asc(topics.label));

  return NextResponse.json(rows);
}

const createSchema = z.object({
  companyId: z.string().uuid(),
  label: z.string().min(1).max(80).transform((v) => v.trim()),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  try {
    const [row] = await db.insert(topics).values(parsed.data).returning();
    return NextResponse.json(row, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json({ error: "Topic already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to create topic" }, { status: 500 });
  }
}
