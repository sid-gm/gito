import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { trackedUserHandles } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

const PLATFORMS = ["twitter", "threads", "reddit", "instagram", "facebook", "linkedin"] as const;
type SocialPlatform = (typeof PLATFORMS)[number];

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("companyId");
  const platform = searchParams.get("platform");

  const conditions = [];
  if (companyId) conditions.push(eq(trackedUserHandles.companyId, companyId));
  if (platform && (PLATFORMS as readonly string[]).includes(platform)) {
    conditions.push(eq(trackedUserHandles.platform, platform as SocialPlatform));
  }

  const rows = await db
    .select()
    .from(trackedUserHandles)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(trackedUserHandles.createdAt);

  return NextResponse.json(rows);
}

const addSchema = z.object({
  platform: z
    .string()
    .min(1)
    .max(50)
    .transform((v) => v.trim().toLowerCase())
    .pipe(z.enum(["twitter", "threads", "reddit", "instagram", "facebook", "linkedin"])),
  username: z.string().min(1).max(100).transform((v) => v.replace(/^[@u\/]+/, "").trim()),
  companyId: z.string().uuid(),
});

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = addSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const { platform, username, companyId } = parsed.data;

  try {
    const [row] = await db
      .insert(trackedUserHandles)
      .values({ platform, username, companyId })
      .returning();
    return NextResponse.json(row, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json({ error: "User already tracked" }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to add user" }, { status: 500 });
  }
}
