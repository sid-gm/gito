"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";

// ─── Types ────────────────────────────────────────────────────────────────────

type ReportCluster = {
  id: string;
  label: string | null;
  itemCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  narrativeStage: string | null;
  narrativeSummary: string | null;
  sentimentScore: number | null;
  sentimentLabel: string | null;
  newsSentimentScore: number | null;
  newsSentimentLabel: string | null;
  socialSentimentScore: number | null;
  socialSentimentLabel: string | null;
  aiSummary: string | null;
  velocity24h: number | null;
  prevVelocity24h: number | null;
  platformCount: number | null;
  analystClassification: string | null;
  analystNote: string | null;
  entityLabel: string | null;
  companyName: string | null;
};

type PeriodNarrative = {
  periodDate: string;
  aiNarrative: string | null;
  analystNarrative: string | null;
};

type ReportItem = {
  platform: string;
  title: string | null;
  author: string | null;
  publishedAt: string | null;
  url: string | null;
  analystNote: string | null;
};

type SourceRow = {
  platform: string;
  itemCount: number;
};

type ReportData = {
  reportId: string;
  generatedAt: string;
  analystSummary: string | null;
  cluster: ReportCluster;
  narratives: PeriodNarrative[];
  items: ReportItem[];
  sourceBreakdown: SourceRow[];
};

// ─── Platform config ──────────────────────────────────────────────────────────

const PLATFORMS: Record<string, { label: string; short: string; hue: number; color: string }> = {
  hackernews:    { label: "HackerNews",    short: "HN", hue: 30,  color: "oklch(0.62 0.16 30)" },
  reddit:        { label: "Reddit",        short: "RD", hue: 10,  color: "oklch(0.62 0.16 10)" },
  twitter:       { label: "X / Twitter",   short: "XM", hue: 210, color: "oklch(0.62 0.16 210)" },
  google_alerts: { label: "Google Alerts", short: "GA", hue: 230, color: "oklch(0.62 0.16 230)" },
  manual:        { label: "Manual",        short: "MN", hue: 280, color: "oklch(0.62 0.16 280)" },
};

function getPlatform(key: string) {
  return PLATFORMS[key] ?? { label: key, short: key.slice(0, 2).toUpperCase(), hue: 0, color: "var(--ink-40)" };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function friendlyDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function timeStr(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
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
  if (score >= 0.3)  return "var(--ok)";
  return "var(--warn)";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PlatformChip({ platform }: { platform: string }) {
  const p = getPlatform(platform);
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      fontSize: 11, padding: "2px 7px 2px 4px", borderRadius: 999,
      background: `oklch(0.96 0.02 ${p.hue})`,
      color: `oklch(0.32 0.08 ${p.hue})`,
      border: `1px solid oklch(0.88 0.04 ${p.hue})`,
      whiteSpace: "nowrap", lineHeight: 1.4,
      fontFamily: "var(--font-mono)",
    }}>
      <span style={{
        fontSize: 9.5, fontWeight: 600, letterSpacing: "0.04em",
        padding: "1px 4px", borderRadius: 3,
        background: `oklch(0.65 0.14 ${p.hue})`,
        color: "#fff", lineHeight: 1.3,
      }}>{p.short}</span>
      {p.label}
    </span>
  );
}

function PlatformBadge({ platform }: { platform: string }) {
  const p = getPlatform(platform);
  return (
    <span style={{
      fontFamily: "var(--font-mono)", fontSize: 9.5, fontWeight: 600,
      letterSpacing: "0.04em", padding: "1px 5px", borderRadius: 3,
      background: p.color, color: "#fff", whiteSpace: "nowrap",
    }}>{p.short}</span>
  );
}

function SentMiniBar({ value }: { value: number }) {
  const clamped = Math.max(-1, Math.min(1, value));
  const w = Math.abs(clamped) * 50;
  return (
    <div style={{ position: "relative", width: "100%", height: 8, background: "var(--ink-10)", borderRadius: 2 }}>
      <span style={{ position: "absolute", left: "50%", top: -2, bottom: -2, width: 1, background: "var(--ink-30)" }} />
      <span style={{
        position: "absolute", top: 0, bottom: 0, borderRadius: 2,
        width: `${w}%`,
        ...(clamped < 0 ? { right: "50%", background: "var(--neg)" } : { left: "50%", background: "var(--pos)" }),
      }} />
    </div>
  );
}

function SentimentCard({ label, score, sentimentLabel }: { label: string; score: number | null; sentimentLabel: string | null }) {
  return (
    <div style={{ padding: "18px 22px" }}>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--ink-50)", marginBottom: 8 }}>{label}</div>
      {score != null ? (
        <>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
            <span style={{ fontSize: 30, fontWeight: 600, letterSpacing: "-0.02em", lineHeight: 1, color: sentColor(score), fontVariantNumeric: "tabular-nums" }}>
              {score >= 0 ? "+" : ""}{score.toFixed(2)}
            </span>
            {sentimentLabel && (
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 500, padding: "2px 6px", borderRadius: 3, background: "color-mix(in oklch, var(--ink-50) 10%, transparent)", color: "var(--ink-60)" }}>
                {sentimentLabel}
              </span>
            )}
          </div>
          <SentMiniBar value={score} />
        </>
      ) : (
        <div style={{ fontSize: 30, fontWeight: 600, color: "var(--ink-30)" }}>—</div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ReportPage() {
  const params = useParams<{ reportId: string }>();
  const [data, setData] = useState<ReportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summaryText, setSummaryText] = useState<string>("");
  const [savingState, setSavingState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch(`/api/reports/${params.reportId}`)
      .then((r) => r.ok ? r.json() : Promise.reject("not found"))
      .then((d: ReportData) => {
        setData(d);
        setSummaryText(d.analystSummary ?? d.cluster.aiSummary ?? "");
      })
      .catch(() => setError("Report not found."));
  }, [params.reportId]);

  async function saveSummary() {
    if (!data) return;
    setSavingState("saving");
    try {
      const res = await fetch(`/api/reports/${params.reportId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analystSummary: summaryText }),
      });
      setSavingState(res.ok ? "saved" : "error");
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => setSavingState("idle"), 2500);
    } catch {
      setSavingState("error");
    }
  }

  if (error) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh", color: "var(--ink-50)", fontFamily: "var(--font-mono)", fontSize: 13 }}>
        {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh", color: "var(--ink-50)", fontFamily: "var(--font-mono)", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.1em" }}>
        Loading…
      </div>
    );
  }

  const { cluster, narratives, items, sourceBreakdown } = data;

  const maxSourceCount = Math.max(...sourceBreakdown.map((s) => s.itemCount), 1);

  const periodEntries = narratives
    .filter((n) => n.analystNarrative || n.aiNarrative)
    .map((n, i) => ({
      day: i + 1,
      date: friendlyDate(n.periodDate),
      text: n.analystNarrative ?? n.aiNarrative ?? "",
    }));

  const generatedAt = data.generatedAt
    ? new Date(data.generatedAt).toISOString().slice(0, 16).replace("T", " ") + " UTC"
    : "—";

  const displaySummary = data.analystSummary ?? cluster.aiSummary ?? null;

  const newsSentScore = cluster.newsSentimentScore ?? null;
  const newsSentLabel = cluster.newsSentimentLabel ?? null;
  const socialSentScore = cluster.socialSentimentScore ?? null;
  const socialSentLabel = cluster.socialSentimentLabel ?? null;

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 32px 80px", fontFamily: "var(--font-sans)" }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 24, paddingBottom: 18, borderBottom: "1px solid var(--border)", marginBottom: 24, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 32, height: 32, borderRadius: 6, background: "var(--ink)", display: "grid", placeItems: "center", color: "var(--paper)", fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: 11, letterSpacing: "0.5px", flexShrink: 0 }}>
            GT
          </div>
          <div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--ink-50)", lineHeight: 1.2 }}>
              Signal Brief
            </div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-70)", lineHeight: 1.3 }}>
              {cluster.companyName && <>Tracking <strong style={{ color: "var(--ink)" }}>{cluster.companyName}</strong> · </>}
              {shortDate(cluster.firstSeenAt)} → {shortDate(cluster.lastSeenAt)}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-60)", flexWrap: "wrap" }}>
          <span>Updated <strong style={{ color: "var(--ink)" }}>{relativeTime(cluster.lastSeenAt)}</strong></span>
          <span>·</span>
          <span><strong style={{ color: "var(--ink)" }}>{cluster.itemCount}</strong> items</span>
          {cluster.platformCount && cluster.platformCount > 0 && (
            <>
              <span>·</span>
              <span><strong style={{ color: "var(--ink)" }}>{cluster.platformCount}</strong> platforms</span>
            </>
          )}
        </div>
      </header>

      {/* ── Hero ───────────────────────────────────────────────────────────── */}
      <section style={{ paddingBottom: 8 }}>
        <h1 style={{ fontSize: 36, fontWeight: 600, letterSpacing: "-0.025em", lineHeight: 1.05, margin: "0 0 24px", color: "var(--ink)" }}>
          {cluster.label ?? <span style={{ color: "var(--ink-40)", fontStyle: "italic" }}>Unnamed cluster</span>}
        </h1>

        {/* News + Social sentiment row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", border: "1px solid var(--border)", borderRadius: 10, background: "var(--paper)", overflow: "hidden" }}>
          <div style={{ borderRight: "1px solid var(--border-soft)" }}>
            <SentimentCard label="News Sentiment" score={newsSentScore} sentimentLabel={newsSentLabel} />
          </div>
          <SentimentCard label="Social Sentiment" score={socialSentScore} sentimentLabel={socialSentLabel} />
        </div>
      </section>

      {/* ── Narrative ──────────────────────────────────────────────────────── */}
      {periodEntries.length > 0 && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontFamily: "var(--font-mono)", fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--ink-50)", padding: "0 0 8px", margin: "32px 0 14px", borderBottom: "1px solid var(--border-soft)" }}>
            <span>Narrative</span>
            <span style={{ fontSize: 10, color: "var(--ink-40)", letterSpacing: "0.06em" }}>how the conversation developed</span>
          </div>
          <div>
            {periodEntries.map((d, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 24, padding: "16px 0", borderTop: i === 0 ? "none" : "1px solid var(--border-soft)" }}>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-50)", paddingTop: 4, lineHeight: 1.3 }}>
                  Day {d.day} · {d.date}
                </div>
                <p style={{ fontSize: 15, lineHeight: 1.6, color: "var(--ink)", margin: 0 }}>
                  {d.text}
                </p>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Summary ────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontFamily: "var(--font-mono)", fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--ink-50)", padding: "0 0 8px", margin: "32px 0 14px", borderBottom: "1px solid var(--border-soft)" }}>
        <span>Summary</span>
        <span style={{ fontSize: 10, color: "var(--ink-40)", letterSpacing: "0.06em" }}>news coverage vs. online reaction</span>
      </div>
      <div style={{ background: "var(--paper)", border: "1px solid var(--border)", borderRadius: 10, padding: "20px 24px" }}>
        {displaySummary || summaryText ? (
          <>
            <textarea
              value={summaryText}
              onChange={(e) => { setSummaryText(e.target.value); setSavingState("idle"); }}
              rows={5}
              style={{
                width: "100%", fontSize: 15, lineHeight: 1.65, color: "var(--ink)",
                fontFamily: "var(--font-sans)", background: "transparent",
                border: "1px solid var(--border-soft)", borderRadius: 6,
                padding: "10px 14px", resize: "vertical", outline: "none",
                boxSizing: "border-box",
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = "var(--border-soft)"; }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, justifyContent: "flex-end" }}>
              {savingState === "saved" && <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ok)" }}>Saved</span>}
              {savingState === "error" && <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--err)" }}>Save failed</span>}
              <button
                onClick={saveSummary}
                disabled={savingState === "saving"}
                style={{
                  fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600, letterSpacing: "0.05em",
                  padding: "5px 14px", borderRadius: 5, cursor: savingState === "saving" ? "default" : "pointer",
                  background: "var(--accent)", color: "#fff", border: "none",
                  opacity: savingState === "saving" ? 0.6 : 1,
                }}
              >
                {savingState === "saving" ? "Saving…" : "Save"}
              </button>
            </div>
          </>
        ) : (
          <div style={{ color: "var(--ink-40)", fontFamily: "var(--font-mono)", fontSize: 12, fontStyle: "italic" }}>
            No summary yet — regenerate the report to produce an AI summary.
          </div>
        )}
      </div>

      {/* ── Source breakdown ───────────────────────────────────────────────── */}
      {sourceBreakdown.length > 0 && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontFamily: "var(--font-mono)", fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--ink-50)", padding: "0 0 8px", margin: "32px 0 14px", borderBottom: "1px solid var(--border-soft)" }}>
            <span>Sources</span>
            <span style={{ fontSize: 10, color: "var(--ink-40)", letterSpacing: "0.06em" }}>by platform</span>
          </div>
          <div style={{ background: "var(--paper)", border: "1px solid var(--border)", borderRadius: 10, padding: "18px 20px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {sourceBreakdown.map((s) => {
                const p = getPlatform(s.platform);
                return (
                  <div key={s.platform} style={{ display: "grid", gridTemplateColumns: "110px 1fr 36px", gap: 10, alignItems: "center" }}>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-80)", display: "flex", alignItems: "center", gap: 5, overflow: "hidden" }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color, flexShrink: 0 }} />
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.label}</span>
                    </span>
                    <div style={{ height: 14, background: "var(--ink-10)", borderRadius: 2, overflow: "hidden" }}>
                      <div style={{ height: "100%", borderRadius: 2, background: p.color, width: `${(s.itemCount / maxSourceCount) * 100}%` }} />
                    </div>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-70)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{s.itemCount}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* ── Timeline ───────────────────────────────────────────────────────── */}
      {items.length > 0 && (() => {
        const byDate: Record<string, ReportItem[]> = {};
        for (const item of items) {
          const key = item.publishedAt
            ? new Date(item.publishedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
            : "Unknown date";
          (byDate[key] ??= []).push(item);
        }
        const days = Object.keys(byDate).sort((a, b) => {
          const da = byDate[a][0].publishedAt;
          const db = byDate[b][0].publishedAt;
          if (!da) return 1;
          if (!db) return -1;
          return new Date(da).getTime() - new Date(db).getTime();
        });
        if (days.length < 2) return null;
        return (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontFamily: "var(--font-mono)", fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--ink-50)", padding: "0 0 8px", margin: "32px 0 14px", borderBottom: "1px solid var(--border-soft)" }}>
              <span>Timeline</span>
              <span style={{ fontSize: 10, color: "var(--ink-40)", letterSpacing: "0.06em" }}>{days.length} days · news &amp; social</span>
            </div>
            <div style={{ position: "relative", paddingLeft: 20 }}>
              <div style={{ position: "absolute", left: 7, top: 8, bottom: 8, width: 1, background: "var(--border-soft)" }} />
              {days.map((day, di) => {
                const dayItems = byDate[day];
                return (
                  <div key={day} style={{ position: "relative", paddingBottom: di < days.length - 1 ? 20 : 0 }}>
                    <div style={{ position: "absolute", left: -16, top: 6, width: 8, height: 8, borderRadius: "50%", background: "var(--accent)", border: "2px solid var(--paper)" }} />
                    <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-70)" }}>{day}</span>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--ink-40)" }}>{dayItems.length} item{dayItems.length !== 1 ? "s" : ""}</span>
                    </div>
                    <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
                      {dayItems.slice(0, 5).map((it, ii) => (
                        <li key={ii} style={{ fontSize: 13, lineHeight: 1.45, color: "var(--ink-80)", display: "flex", alignItems: "flex-start", gap: 8 }}>
                          <PlatformBadge platform={it.platform} />
                          <span>
                            {it.url ? (
                              <a href={it.url} target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "none" }}
                                onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = "underline"; }}
                                onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = "none"; }}>
                                {it.title ?? it.url}
                              </a>
                            ) : (
                              it.title ?? "—"
                            )}
                          </span>
                        </li>
                      ))}
                      {dayItems.length > 5 && (
                        <li style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-40)" }}>+{dayItems.length - 5} more</li>
                      )}
                    </ul>
                  </div>
                );
              })}
            </div>
          </>
        );
      })()}

      {/* ── Supporting evidence ────────────────────────────────────────────── */}
      {items.length > 0 && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontFamily: "var(--font-mono)", fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--ink-50)", padding: "0 0 8px", margin: "32px 0 0", borderBottom: "1px solid var(--border-soft)" }}>
            <span>Supporting evidence</span>
            <span style={{ fontSize: 10, color: "var(--ink-40)", letterSpacing: "0.06em" }}>{items.length} of {cluster.itemCount} cluster items</span>
          </div>
          <div>
            {items.map((ev, i) => (
              <div
                key={i}
                style={{ display: "grid", gridTemplateColumns: "auto 55px 1fr", gap: 14, padding: "12px 0", borderTop: "1px solid var(--border-soft)", alignItems: "start" }}
              >
                <PlatformChip platform={ev.platform} />
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-50)", paddingTop: 2 }}>
                  {timeStr(ev.publishedAt)}
                </div>
                <div>
                  {ev.url ? (
                    <a href={ev.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13.5, fontWeight: 500, lineHeight: 1.4, color: "var(--ink)", textDecoration: "none" }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = "underline"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = "none"; }}>
                      {ev.title ?? ev.url}
                    </a>
                  ) : (
                    <span style={{ fontSize: 13.5, fontWeight: 500, lineHeight: 1.4, color: "var(--ink)" }}>
                      {ev.title ?? "—"}
                    </span>
                  )}
                  {ev.author && (
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-50)", marginTop: 2 }}>
                      {ev.author}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <footer style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 22, marginTop: 32, borderTop: "1px solid var(--border-soft)", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-50)" }}>
        <span>Gito · Signal Brief · {data.reportId.slice(0, 8)}</span>
        <span>Generated {generatedAt}</span>
      </footer>
    </div>
  );
}
