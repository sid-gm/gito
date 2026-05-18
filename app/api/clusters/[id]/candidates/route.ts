import { NextResponse } from "next/server";
import { sql, and, or, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { ingestedItems } from "@/lib/db/schema";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const q = new URL(req.url).searchParams.get("q") ?? "";
  if (q.length < 2) return NextResponse.json([]);
  const like = `%${q}%`;
  const rows = await db
    .select({
      id: ingestedItems.id,
      title: ingestedItems.title,
      url: ingestedItems.url,
      platform: ingestedItems.platform,
      author: ingestedItems.author,
      publishedAt: ingestedItems.publishedAt,
      createdAt: ingestedItems.createdAt,
    })
    .from(ingestedItems)
    .where(
      and(
        sql`${ingestedItems.id} NOT IN (SELECT item_id FROM cluster_items WHERE cluster_id = ${id})`,
        or(
          sql`${ingestedItems.title} ILIKE ${like}`,
          sql`${ingestedItems.url} ILIKE ${like}`
        )
      )
    )
    .orderBy(desc(ingestedItems.createdAt))
    .limit(30);
  return NextResponse.json(rows);
}
