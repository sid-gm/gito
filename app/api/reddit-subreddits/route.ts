import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { redditSubreddits } from "@/lib/db/schema";
import { eq, count } from "drizzle-orm";
import { z } from "zod";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("companyId");
  if (!companyId) {
    return NextResponse.json({ error: "companyId required" }, { status: 400 });
  }

  const rows = await db
    .select()
    .from(redditSubreddits)
    .where(eq(redditSubreddits.companyId, companyId))
    .orderBy(redditSubreddits.createdAt);

  return NextResponse.json(rows);
}

const addSchema = z.object({
  companyId: z.string().uuid(),
  subredditName: z
    .string()
    .min(3)
    .max(21)
    .regex(/^[a-zA-Z0-9_\/]+$/, "Subreddit names may only contain letters, numbers, and underscores")
    .transform((v) => v.toLowerCase().replace(/^r\//, "")),
  sorts: z.array(z.enum(["new", "hot"])).min(1).optional().default(["new"]),
  keywordFilters: z.array(z.string().min(1).max(100)).optional().default([]),
}).refine(
  (data) => data.subredditName !== "all" || data.keywordFilters.length > 0,
  { message: "Keywords are required when tracking all of Reddit", path: ["keywordFilters"] }
);

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = addSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const { companyId, subredditName, sorts, keywordFilters } = parsed.data;

  const [{ total }] = await db
    .select({ total: count() })
    .from(redditSubreddits)
    .where(eq(redditSubreddits.companyId, companyId));
  if (total >= 20) {
    return NextResponse.json({ error: "Maximum of 20 subreddits per company" }, { status: 400 });
  }

  try {
    const [row] = await db
      .insert(redditSubreddits)
      .values({ companyId, subredditName, sorts: [...new Set(sorts)], keywordFilters })
      .returning();
    return NextResponse.json(row, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json({ error: "Subreddit already tracked" }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to add subreddit" }, { status: 500 });
  }
}
