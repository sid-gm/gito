import { NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron-auth";
import { runClustering } from "@/lib/ai/run-cluster";

export async function GET(req: Request) {
  const authError = verifyCronSecret(req);
  if (authError) return authError;

  try {
    const result = await runClustering(100);
    console.log(`[cron/cluster] assigned ${result.assigned}, created ${result.created}`);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron/cluster]", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
