import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { trackedThreads } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";

const createSchema = z.object({
  companyId: z.string().uuid(),
  platform: z.enum(["twitter", "threads", "reddit", "instagram", "facebook", "linkedin"]),
  postUrl: z.string().url(),
  postExternalId: z.string().optional(),
  topicId: z.string().uuid().optional(),
  label: z.string().optional(),
});

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("companyId");
  if (!companyId) return NextResponse.json({ error: "companyId required" }, { status: 400 });

  const rows = await db
    .select()
    .from(trackedThreads)
    .where(eq(trackedThreads.companyId, companyId))
    .orderBy(trackedThreads.createdAt);

  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const body = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });

  const [row] = await db
    .insert(trackedThreads)
    .values({
      companyId: body.data.companyId,
      platform: body.data.platform,
      postUrl: body.data.postUrl,
      postExternalId: body.data.postExternalId ?? null,
      topicId: body.data.topicId ?? null,
      label: body.data.label ?? null,
    })
    .onConflictDoNothing({ target: [trackedThreads.companyId, trackedThreads.postUrl] })
    .returning();

  return NextResponse.json(row ?? { message: "Already tracked" }, { status: row ? 201 : 200 });
}
