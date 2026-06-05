import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { trackedUserHandles } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("companyId");

  const where = companyId
    ? and(eq(trackedUserHandles.id, id), eq(trackedUserHandles.companyId, companyId))
    : eq(trackedUserHandles.id, id);

  await db.delete(trackedUserHandles).where(where);
  return NextResponse.json({ ok: true });
}
