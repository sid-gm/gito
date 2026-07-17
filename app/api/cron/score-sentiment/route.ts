import { NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron-auth";
import { scoreUnscoredItems } from "@/lib/ai/item-sentiment";

export const maxDuration = 300;

// Daily forward scoring of everything the collectors brought in. Feeds the
// Raw data, Sentiment, and Bubbles views.
export async function GET(req: Request) {
  const authError = verifyCronSecret(req);
  if (authError) return authError;

  const result = await scoreUnscoredItems({ days: 7, limit: 800 });
  return NextResponse.json({ ok: true, ...result });
}
