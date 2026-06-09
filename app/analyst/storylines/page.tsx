"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useCompany } from "@/components/CompanyContext";

type StorylineRow = {
  id: string;
  entityId: string;
  entityLabel: string | null;
  title: string;
  summary: string | null;
  status: string;
  firstSeenAt: string;
  lastSeenAt: string;
  newsSentimentScore: number | null;
  socialSentimentScore: number | null;
  clusterCount: number;
  totalItems: number;
};

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function sentColor(score: number | null): string {
  if (score == null) return "var(--ink-50)";
  if (score <= -0.3) return "var(--err)";
  if (score >= 0.3) return "var(--ok)";
  return "var(--warn)";
}

function StatusPill({ status }: { status: string }) {
  const open = status === "open";
  const color = open ? "var(--accent)" : "var(--ink-30)";
  return (
    <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color, border: `1px solid ${color}`, borderRadius: 3, padding: "1px 5px", lineHeight: 1.4 }}>
      {open ? "OPEN" : "CLOSED"}
    </span>
  );
}

function SentPair({ news, social }: { news: number | null; social: number | null }) {
  const fmt = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}`);
  return (
    <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-40)", whiteSpace: "nowrap" }}>
      news <span style={{ color: sentColor(news), fontWeight: 600 }}>{fmt(news)}</span>
      {" · "}
      social <span style={{ color: sentColor(social), fontWeight: 600 }}>{fmt(social)}</span>
    </span>
  );
}

export default function StorylinesPage() {
  const { activeCompanyId } = useCompany();
  const router = useRouter();

  const [rows, setRows] = useState<StorylineRow[]>([]);
  const [status, setStatus] = useState("open");
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<string | null>(null);

  const fetchStorylines = useCallback(async () => {
    if (!activeCompanyId) return;
    setLoading(true);
    const params = new URLSearchParams({ companyId: activeCompanyId, status });
    const res = await fetch(`/api/storylines?${params}`);
    const data = await res.json();
    setRows(data.storylines ?? []);
    setLoading(false);
  }, [activeCompanyId, status]);

  useEffect(() => { fetchStorylines(); }, [fetchStorylines]);

  const runAssign = useCallback(async () => {
    setRunning(true);
    setRunResult(null);
    try {
      const res = await fetch("/api/run/assign-storylines", { method: "POST" });
      const data = await res.json();
      setRunResult(
        data.assigned === 0 && data.created === 0
          ? "nothing new to assign"
          : `${data.assigned} clusters placed · ${data.created} new storylines`
      );
      fetchStorylines();
    } catch {
      setRunResult("error — check console");
    } finally {
      setRunning(false);
    }
  }, [fetchStorylines]);

  return (
    <>
      <header className="topbar">
        <div>
          <div className="eyebrow">Classify · Storylines</div>
          <h1 className="page-title">Storylines</h1>
          <p className="page-desc">Narrative arcs above clusters — how related events connect across platforms and days.</p>
        </div>
        <div className="topbar-actions">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button className="btn-ghost btn" onClick={runAssign} disabled={running}>
              {running ? "Assigning…" : "Assign storylines"}
            </button>
            {runResult && <span style={{ fontSize: 12, color: "var(--ink-40)", whiteSpace: "nowrap" }}>{runResult}</span>}
          </div>
        </div>
      </header>

      <div className="page">
        <div className="toolbar" style={{ flexWrap: "wrap", gap: 8 }}>
          <div className="filter-group">
            <span className="filter-label">Status</span>
            <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
              <option value="all">All</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="empty"><div className="empty-mark">⧖</div><div className="empty-title">Loading storylines…</div></div>
        ) : rows.length === 0 ? (
          <div className="empty">
            <div className="empty-mark">∿</div>
            <div className="empty-title">No storylines yet</div>
            <div className="empty-sub">Run “Assign storylines” to group narrative clusters into arcs.</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {rows.map((s) => (
              <div
                key={s.id}
                className="cluster-card"
                style={{ cursor: "pointer" }}
                onClick={() => router.push(`/analyst/storylines/${s.id}`)}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
                      <StatusPill status={s.status} />
                      {s.entityLabel && (
                        <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", padding: "2px 8px", borderRadius: 99, background: "color-mix(in oklch, var(--accent) 8%, var(--paper))", color: "var(--ink-60)", border: "1px solid color-mix(in oklch, var(--accent) 18%, transparent)", whiteSpace: "nowrap" }}>
                          {s.entityLabel}
                        </span>
                      )}
                      <SentPair news={s.newsSentimentScore} social={s.socialSentimentScore} />
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.35 }}>{s.title}</div>
                    {s.summary && (
                      <p style={{ fontSize: 12.5, color: "var(--ink-60)", lineHeight: 1.5, margin: "4px 0 0" }}>{s.summary}</p>
                    )}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-40)", whiteSpace: "nowrap" }}>
                      {s.clusterCount} events · {s.totalItems} items
                    </span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-30)", whiteSpace: "nowrap" }}>
                      {shortDate(s.firstSeenAt)} → {relativeTime(s.lastSeenAt)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
