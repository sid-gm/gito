import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { threadsFilters } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("companyId");

  const where = companyId
    ? and(eq(threadsFilters.id, id), eq(threadsFilters.companyId, companyId))
    : eq(threadsFilters.id, id);

  await db.delete(threadsFilters).where(where);
  return NextResponse.json({ ok: true });
}
