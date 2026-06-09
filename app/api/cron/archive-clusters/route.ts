import { NextResponse } from "next/server";
import { and, eq, isNull, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { clusters, storylines } from "@/lib/db/schema";
import { verifyCronSecret } from "@/lib/cron-auth";

const ARCHIVE_AFTER_DAYS = 90;
const STORYLINE_CLOSE_AFTER_DAYS = 21;

export async function GET(req: Request) {
  const authError = verifyCronSecret(req);
  if (authError) return authError;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - ARCHIVE_AFTER_DAYS);

  try {
    const result = await db
      .update(clusters)
      .set({ archivedAt: new Date() })
      .where(and(isNull(clusters.archivedAt), lt(clusters.lastSeenAt, cutoff)))
      .returning({ id: clusters.id });

    const storylineCutoff = new Date();
    storylineCutoff.setDate(storylineCutoff.getDate() - STORYLINE_CLOSE_AFTER_DAYS);
    const closed = await db
      .update(storylines)
      .set({ status: "closed", updatedAt: new Date() })
      .where(and(eq(storylines.status, "open"), lt(storylines.lastSeenAt, storylineCutoff)))
      .returning({ id: storylines.id });

    return NextResponse.json({ ok: true, archived: result.length, storylinesClosed: closed.length });
  } catch (err) {
    console.error("[archive-clusters]", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
