import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { twitterHandles } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("companyId");

  const rows = await db
    .select()
    .from(twitterHandles)
    .where(companyId ? eq(twitterHandles.companyId, companyId) : undefined)
    .orderBy(twitterHandles.createdAt);

  return NextResponse.json(
    rows.map((r) => ({ id: r.id, handle: r.handle, createdAt: r.createdAt }))
  );
}

const addSchema = z.object({
  handle: z
    .string()
    .min(1)
    .max(50)
    .transform((v) => v.replace(/^@/, "").trim().toLowerCase()),
  companyId: z.string().uuid(),
});

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = addSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const { handle, companyId } = parsed.data;

  if (!handle) {
    return NextResponse.json({ error: "Handle is required" }, { status: 400 });
  }

  try {
    const [row] = await db
      .insert(twitterHandles)
      .values({ handle, companyId })
      .returning();
    return NextResponse.json(
      { id: row.id, handle: row.handle, createdAt: row.createdAt },
      { status: 201 }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json({ error: "Handle already tracked" }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to add handle" }, { status: 500 });
  }
}
