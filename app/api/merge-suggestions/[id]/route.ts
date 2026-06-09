import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { clusterMergeSuggestions } from "@/lib/db/schema";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { status } = z
      .object({ status: z.enum(["accepted", "dismissed"]) })
      .parse(await req.json());

    const [updated] = await db
      .update(clusterMergeSuggestions)
      .set({ status, resolvedAt: new Date() })
      .where(eq(clusterMergeSuggestions.id, id))
      .returning({ id: clusterMergeSuggestions.id });

    if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
}
