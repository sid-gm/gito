"use client";

import { useEffect, useState } from "react";
import { useAnalyst } from "@/components/analyst/AnalystContext";
import { platformMeta, timeAgo } from "@/components/analyst/data";

const SOCIAL_PLATFORMS = ["reddit", "twitter", "threads", "instagram", "facebook", "linkedin"];

interface RunEvent {
  id: string;
  runId: string;
  at: string;
  platform: string;
  sourceKind: string | null;
  sourceRef: string | null;
  status: string;
  detail: string | null;
  itemsCount: number;
}

interface Run {
  id: string;
  triggeredBy: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  itemsCollected: number;
  itemsInserted: number;
  events: RunEvent[];
}

interface Health {
  platform: string;
  state: "ok" | "degraded" | "blocked";
  since: string;
  lastOkAt: string | null;
}

interface Feed {
  id: string;
  label: string;
  feedUrl: string;
  isActive: boolean;
  itemCount: number;
  lastItemAt: string | null;
}

interface Settings {
  intervalMinutes: number;
  enabled: boolean;
  pausedPlatforms: string[];
}

interface SourcesData {
  runs: Run[];
  health: Health[];
  feeds: Feed[];
  settings: Settings | null;
  visionFallbacksInWindow: number;
}

function StatusPill({ kind, label }: { kind: "active" | "paused"; label: string }) {
  return (
    <span className={`an-status ${kind === "active" ? "an-status-active" : "an-status-paused"}`}>
      {label}
    </span>
  );
}

const RUN_STATUS_COLOR: Record<string, string> = {
  ok: "#34d399",
  partial: "#f59e0b",
  failed: "#fb7185",
  running: "#4f7cff",
};

interface Derived {
  todayByPlatform: Record<string, number>;
  connected: boolean;
}

// Time-dependent rollups happen at fetch time, not during render
function deriveFromData(data: SourcesData): Derived {
  const runs = data.runs ?? [];
  const today = new Date().toDateString();
  const todayByPlatform: Record<string, number> = {};
  for (const run of runs) {
    if (new Date(run.startedAt).toDateString() !== today) continue;
    for (const e of run.events) {
      todayByPlatform[e.platform] = (todayByPlatform[e.platform] ?? 0) + e.itemsCount;
    }
  }
  const lastRun = runs[0] ?? null;
  const connected = lastRun
    ? Date.now() - new Date(lastRun.startedAt).getTime() <
      Math.max(2 * (data.settings?.intervalMinutes ?? 30), 120) * 60_000
    : false;
  return { todayByPlatform, connected };
}

export default function SourcesPage() {
  const { companyId } = useAnalyst();
  const [data, setData] = useState<SourcesData | null>(null);
  const [derived, setDerived] = useState<Derived>({ todayByPlatform: {}, connected: false });
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  const loading = companyId != null && loadedKey !== companyId;

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    fetch(`/api/analyst/sources?companyId=${companyId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: SourcesData) => {
        if (cancelled) return;
        setData(d);
        setDerived(deriveFromData(d));
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadedKey(companyId);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const runs = data?.runs ?? [];
  const lastRun = runs[0] ?? null;
  const healthByPlatform = new Map((data?.health ?? []).map((h) => [h.platform, h]));
  const paused = new Set(data?.settings?.pausedPlatforms ?? []);
  const { todayByPlatform, connected } = derived;

  return (
    <div className="an-sources">
      <section className="an-source-card">
        <div className="an-source-head">
          <div className="an-source-icon">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
            >
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <line x1="3" y1="9" x2="21" y2="9" />
            </svg>
          </div>
          <div className="an-source-titles">
            <div className="an-source-title">Browser extension</div>
            <div className="an-source-sub">
              {lastRun ? `last run ${timeAgo(lastRun.startedAt)} ago` : "no runs yet"}
              {data?.settings ? ` · every ${data.settings.intervalMinutes}m` : ""}
            </div>
          </div>
          <span className="an-source-status">
            <span
              className="an-live-dot"
              style={connected ? undefined : { background: "#4b5568", boxShadow: "none" }}
            />
            {connected ? "Connected" : "Idle"}
          </span>
        </div>
        {SOCIAL_PLATFORMS.map((key) => {
          const pm = platformMeta(key);
          const h = healthByPlatform.get(key);
          const todayCount = todayByPlatform[key] ?? 0;
          let pill: { kind: "active" | "paused"; label: string };
          if (paused.has(key)) pill = { kind: "paused", label: "Paused" };
          else if (h?.state === "blocked") pill = { kind: "paused", label: "Blocked" };
          else if (h?.state === "degraded") pill = { kind: "paused", label: "Degraded" };
          else if (h?.state === "ok") pill = { kind: "active", label: "Active" };
          else pill = { kind: "paused", label: "Idle" };
          return (
            <div key={key} className="an-source-row">
              <div className="an-source-row-id">
                <span
                  className="an-tag"
                  style={{ background: pm.color + "22", color: pm.color }}
                >
                  {pm.tag}
                </span>
                <span className="an-source-row-label">{pm.label}</span>
              </div>
              <span className="an-source-row-stat">
                {todayCount.toLocaleString()}
                <span> today</span>
              </span>
              <StatusPill kind={pill.kind} label={pill.label} />
            </div>
          );
        })}
        {data != null && data.visionFallbacksInWindow > 0 && (
          <div className="an-source-row">
            <div className="an-feed-meta" style={{ gridColumn: "1 / -1" }}>
              ⚠ {data.visionFallbacksInWindow} vision-fallback session
              {data.visionFallbacksInWindow === 1 ? "" : "s"} in recent runs —
              selectors may need fixing.
            </div>
          </div>
        )}
      </section>

      <section className="an-source-card">
        <div className="an-source-head">
          <div className="an-source-icon">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
            >
              <circle cx="6.5" cy="17.5" r="2.5" />
              <path d="M5 11a8 8 0 0 1 8 8" />
              <path d="M5 5a14 14 0 0 1 14 14" />
            </svg>
          </div>
          <div className="an-source-titles">
            <div className="an-source-title">RSS feeds</div>
            <div className="an-source-sub">Google News + publishers · daily</div>
          </div>
          <span className="an-source-count">
            {(data?.feeds ?? []).length} feed{(data?.feeds ?? []).length === 1 ? "" : "s"}
          </span>
        </div>
        {(data?.feeds ?? []).map((f) => (
          <div key={f.id} className="an-source-row">
            <div style={{ minWidth: 0 }}>
              <div className="an-feed-name">{f.label}</div>
              <div className="an-feed-meta">
                {f.lastItemAt ? `last item ${timeAgo(f.lastItemAt)} ago` : "no items yet"}
              </div>
            </div>
            <span className="an-source-row-stat">{f.itemCount.toLocaleString()}</span>
            <StatusPill
              kind={f.isActive ? "active" : "paused"}
              label={f.isActive ? "Active" : "Paused"}
            />
          </div>
        ))}
        {!loading && (data?.feeds ?? []).length === 0 && (
          <div className="an-source-row">
            <div className="an-feed-meta">No feeds configured.</div>
          </div>
        )}
      </section>

      <section className="an-source-card" style={{ gridColumn: "1 / -1" }}>
        <div className="an-source-head">
          <div className="an-source-icon">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
            >
              <circle cx="12" cy="12" r="9" />
              <polyline points="12,7 12,12 15.5,14" />
            </svg>
          </div>
          <div className="an-source-titles">
            <div className="an-source-title">Recent runs</div>
            <div className="an-source-sub">Collector sessions, newest first</div>
          </div>
        </div>
        {runs.map((run) => {
          const okEvents = run.events.filter((e) => e.status === "ok").length;
          const badEvents = run.events.filter((e) =>
            ["http_403", "logged_out", "checkpoint", "error"].includes(e.status)
          );
          const detail =
            badEvents.length > 0
              ? `${badEvents.length} failed session${badEvents.length === 1 ? "" : "s"} (${[...new Set(badEvents.map((e) => e.platform))].join(", ")})`
              : `${okEvents}/${run.events.length} sessions ok`;
          return (
            <div key={run.id} className="an-source-row">
              <div style={{ minWidth: 0 }}>
                <div className="an-feed-name">
                  <span
                    className="an-sent-dot"
                    style={{
                      background: RUN_STATUS_COLOR[run.status] ?? "#4b5568",
                      marginRight: 8,
                    }}
                  />
                  {timeAgo(run.startedAt)} ago · {run.triggeredBy}
                </div>
                <div className="an-feed-meta">{detail}</div>
              </div>
              <span className="an-source-row-stat">
                {run.itemsInserted.toLocaleString()}
                <span> new</span>
              </span>
              <StatusPill
                kind={run.status === "ok" || run.status === "running" ? "active" : "paused"}
                label={run.status}
              />
            </div>
          );
        })}
        {!loading && runs.length === 0 && (
          <div className="an-source-row">
            <div className="an-feed-meta">
              No runs yet — connect the extension and hit Run now.
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
