import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { collectSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";

const SOCIAL_PLATFORMS = ["twitter", "threads", "reddit", "instagram", "facebook", "linkedin"] as const;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("companyId");
  if (!companyId) {
    return NextResponse.json({ error: "companyId required" }, { status: 400 });
  }

  await db.insert(collectSettings).values({ companyId }).onConflictDoNothing();
  const [row] = await db.select().from(collectSettings).where(eq(collectSettings.companyId, companyId));
  return NextResponse.json(row);
}

const patchSchema = z.object({
  companyId: z.string().uuid(),
  intervalMinutes: z.number().int().min(10).max(24 * 60).optional(),
  enabled: z.boolean().optional(),
  pausedPlatforms: z.array(z.enum(SOCIAL_PLATFORMS)).optional(),
  maxThreadDrills: z.number().int().min(0).max(20).optional(),
  visionDisabledPlatforms: z.array(z.enum(SOCIAL_PLATFORMS)).optional(),
});

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const { companyId, ...rest } = parsed.data;
  const updates = {
    ...(rest.intervalMinutes !== undefined ? { intervalMinutes: rest.intervalMinutes } : {}),
    ...(rest.enabled !== undefined ? { enabled: rest.enabled } : {}),
    ...(rest.pausedPlatforms ? { pausedPlatforms: [...new Set(rest.pausedPlatforms)] } : {}),
    ...(rest.maxThreadDrills !== undefined ? { maxThreadDrills: rest.maxThreadDrills } : {}),
    ...(rest.visionDisabledPlatforms ? { visionDisabledPlatforms: [...new Set(rest.visionDisabledPlatforms)] } : {}),
  };
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const [row] = await db
    .insert(collectSettings)
    .values({ companyId, ...updates })
    .onConflictDoUpdate({
      target: collectSettings.companyId,
      set: { ...updates, updatedAt: new Date() },
    })
    .returning();

  return NextResponse.json(row);
}
