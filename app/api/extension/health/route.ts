import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sourceHealth } from "@/lib/db/schema";
import type { HealthState } from "@/lib/db/schema";
import { verifyExtensionKey } from "@/lib/extension-auth";
import { sendNotification } from "@/lib/notifications/telegram";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

const bodySchema = z.object({
  platform: z.enum(["twitter", "threads", "reddit", "instagram", "facebook", "linkedin"]),
  status: z.enum(["ok", "zero_results", "http_403", "logged_out", "checkpoint", "error"]),
  detail: z.string().nullish(),
});

// Alerts fire on state TRANSITIONS, not per event; repeats are throttled.
const RENOTIFY_HOURS = 6;

const STATE_FOR_STATUS: Record<z.infer<typeof bodySchema>["status"], HealthState> = {
  ok: "ok",
  zero_results: "degraded",
  error: "degraded",
  http_403: "blocked",
  logged_out: "blocked",
  checkpoint: "blocked",
};

const REASON: Record<string, string> = {
  zero_results: "returning zero results",
  error: "collector errors",
  http_403: "HTTP 403",
  logged_out: "login wall",
  checkpoint: "verification checkpoint",
};

const PLATFORM_LABEL: Record<string, string> = {
  twitter: "X",
  threads: "Threads",
  reddit: "Reddit",
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
};

const PLATFORM_SITE: Record<string, string> = {
  twitter: "x.com",
  threads: "threads.com",
  reddit: "reddit.com",
  instagram: "instagram.com",
  facebook: "facebook.com",
  linkedin: "linkedin.com",
};

function fmtTime(d: Date | null): string {
  if (!d) return "never";
  return d.toLocaleTimeString("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export async function POST(req: Request) {
  const companyId = await verifyExtensionKey(req);
  if (!companyId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: CORS });
  }

  let raw: unknown;
  try { raw = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: CORS });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400, headers: CORS });
  }

  const { platform, status, detail } = parsed.data;
  const newState = STATE_FOR_STATUS[status];
  const now = new Date();

  const [prev] = await db
    .select()
    .from(sourceHealth)
    .where(and(eq(sourceHealth.companyId, companyId), eq(sourceHealth.platform, platform)));

  const prevState: HealthState = prev?.state ?? "ok";
  const transitioned = newState !== prevState;
  const since = transitioned || !prev ? now : prev.since;

  const throttleOk =
    !prev?.lastNotifiedAt ||
    now.getTime() - prev.lastNotifiedAt.getTime() > RENOTIFY_HOURS * 60 * 60 * 1000;
  const notifyProblem = newState !== "ok" && throttleOk;
  const notifyRecovery = transitioned && newState === "ok" && prevState === "blocked";
  const willNotify = notifyProblem || notifyRecovery;

  await db
    .insert(sourceHealth)
    .values({
      companyId,
      platform,
      state: newState,
      since,
      lastOkAt: newState === "ok" ? now : prev?.lastOkAt ?? null,
      lastNotifiedAt: willNotify ? now : prev?.lastNotifiedAt ?? null,
    })
    .onConflictDoUpdate({
      target: [sourceHealth.companyId, sourceHealth.platform],
      set: {
        state: newState,
        since,
        ...(newState === "ok" ? { lastOkAt: now } : {}),
        ...(willNotify ? { lastNotifiedAt: now } : {}),
      },
    });

  const label = PLATFORM_LABEL[platform] ?? platform;
  if (notifyProblem) {
    const reason = REASON[status] ?? status;
    const icon = newState === "blocked" ? "⚠️" : "🟡";
    const advice =
      status === "logged_out" || status === "checkpoint"
        ? ` Open ${PLATFORM_SITE[platform]} in Chrome and log back in.`
        : "";
    await sendNotification(
      `${icon} Gito collector: ${label} is ${newState} (${reason}${detail ? ` — ${detail}` : ""}) since ${fmtTime(since)}. ` +
        `Last successful run: ${fmtTime(prev?.lastOkAt ?? null)}.${advice}`
    );
  } else if (notifyRecovery) {
    await sendNotification(`✅ Gito collector: ${label} has recovered (was blocked since ${fmtTime(prev?.since ?? null)}).`);
  }

  return NextResponse.json({ ok: true, state: newState, transitioned }, { headers: CORS });
}

// Per-platform health dots for the popup
export async function GET(req: Request) {
  const companyId = await verifyExtensionKey(req);
  if (!companyId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: CORS });
  }

  const rows = await db
    .select()
    .from(sourceHealth)
    .where(eq(sourceHealth.companyId, companyId));

  return NextResponse.json(rows, { headers: CORS });
}
