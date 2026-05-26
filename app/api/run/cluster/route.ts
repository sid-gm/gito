import { NextResponse } from "next/server";
import { runClustering } from "@/lib/ai/run-cluster";

export async function POST() {
  try {
    const result = await runClustering(200);
    console.log(`[run/cluster] assigned ${result.assigned}, created ${result.created}`);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[run/cluster]", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
