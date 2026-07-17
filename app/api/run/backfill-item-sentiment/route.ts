import { NextResponse } from "next/server";
import { scoreUnscoredItems } from "@/lib/ai/item-sentiment";

export const maxDuration = 300;

/**
 * Manual backfill of per-item sentiment. The daily cron only scores the
 * trailing 7 days; this scores an arbitrary window on demand.
 * Idempotent — re-run until `remaining` hits 0.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const result = await scoreUnscoredItems({
    companyId: typeof body.companyId === "string" ? body.companyId : undefined,
    days: Number(body.days) || 7,
    limit: Number(body.limit) || 400,
  });
  return NextResponse.json({ ok: true, ...result });
}
