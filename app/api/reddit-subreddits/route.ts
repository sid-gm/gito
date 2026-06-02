import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { redditSubreddits } from "@/lib/db/schema";
import { eq, count } from "drizzle-orm";
import { z } from "zod";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("companyId");

  const rows = await db
    .select()
    .from(redditSubreddits)
    .where(companyId ? eq(redditSubreddits.companyId, companyId) : undefined)
    .orderBy(redditSubreddits.createdAt);

  return NextResponse.json(
    rows.map((r) => ({
      id: r.id,
      subredditName: r.subredditName,
      keywordFilters: r.keywordFilters ?? [],
      createdAt: r.createdAt,
    }))
  );
}

const addSchema = z.object({
  subredditName: z
    .string()
    .min(3)
    .max(21)
    .regex(/^[a-zA-Z0-9_]+$/, "Subreddit names may only contain letters, numbers, and underscores")
    .transform((v) => v.toLowerCase().replace(/^r\//, "")),
  keywordFilters: z.array(z.string().min(1).max(100)).optional().default([]),
  companyId: z.string().uuid().optional(),
});

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = addSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const { subredditName, keywordFilters, companyId } = parsed.data;

  if (companyId) {
    const [{ total }] = await db
      .select({ total: count() })
      .from(redditSubreddits)
      .where(eq(redditSubreddits.companyId, companyId));
    if (total >= 20) {
      return NextResponse.json({ error: "Maximum of 20 subreddits per company" }, { status: 400 });
    }
  }

  try {
    const [row] = await db
      .insert(redditSubreddits)
      .values({ subredditName, keywordFilters, companyId: companyId ?? null })
      .returning();
    return NextResponse.json(
      { id: row.id, subredditName: row.subredditName, keywordFilters: row.keywordFilters ?? [], createdAt: row.createdAt },
      { status: 201 }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json({ error: "Subreddit already tracked" }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to add subreddit" }, { status: 500 });
  }
}
