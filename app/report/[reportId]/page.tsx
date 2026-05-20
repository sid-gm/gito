"use client";

import { useEffect, useState } from "react";
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
};

type SourceRow = {
  platform: string;
  itemCount: number;
};

type VelocityBucket = {
  bucket: string;
  itemCount: number;
};

type ReportData = {
  reportId: string;
  generatedAt: string;
  cluster: ReportCluster;
  narratives: PeriodNarrative[];
  items: ReportItem[];
  sourceBreakdown: SourceRow[];
  velocityHistory: VelocityBucket[];
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

function velocityChange(v24: number | null, prev: number | null): string | null {
  if (v24 == null || prev == null || prev === 0) return null;
  const pct = Math.round(((v24 - prev) / prev) * 100);
  return pct >= 0 ? `▲ ${pct}%` : `▼ ${Math.abs(pct)}%`;
}

function velocityChangeCls(v24: number | null, prev: number | null): string {
  if (v24 == null || prev == null || prev === 0) return "metric-delta-neutral";
  return v24 >= prev ? "metric-delta-err" : "metric-delta-ok";
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

function VelocityChart({ buckets }: { buckets: VelocityBucket[] }) {
  const W = 720, H = 180, PAD = { l: 32, r: 12, t: 14, b: 24 };
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;

  if (!buckets.length) {
    return (
      <div style={{ height: H, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--ink-40)", fontFamily: "var(--font-mono)", fontSize: 11 }}>
        No data in last 48h
      </div>
    );
  }

  const values = buckets.map((b) => b.itemCount);
  const max = Math.max(...values, 1);
  const xs = (i: number) => PAD.l + (i / Math.max(values.length - 1, 1)) * innerW;
  const ys = (v: number) => PAD.t + innerH - (v / max) * innerH;

  const linePath = values.map((v, i) => `${i === 0 ? "M" : "L"}${xs(i).toFixed(1)},${ys(v).toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${xs(values.length - 1)},${ys(0)} L${xs(0)},${ys(0)} Z`;

  let peakIdx = 0;
  for (let i = 1; i < values.length; i++) if (values[i] > values[peakIdx]) peakIdx = i;

  const yTicks = 3;
  const gridLines = Array.from({ length: yTicks + 1 }, (_, i) => ({
    y: PAD.t + (i / yTicks) * innerH,
    v: Math.round(max * (1 - i / yTicks)),
  }));

  const tickCount = Math.min(7, values.length);
  const xLabels = Array.from({ length: tickCount }, (_, i) => {
    const idx = Math.round((i / (tickCount - 1)) * (values.length - 1));
    const hoursAgo = values.length - 1 - idx;
    return { x: xs(idx), label: hoursAgo === 0 ? "now" : `−${hoursAgo}h` };
  });

  return (
    <svg style={{ display: "block", width: "100%", height: "auto" }} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
      {gridLines.map((g, i) => (
        <g key={i}>
          <line x1={PAD.l} x2={W - PAD.r} y1={g.y} y2={g.y} stroke="var(--border-soft)" strokeDasharray={i === yTicks ? "" : "2 4"} />
          <text x={PAD.l - 5} y={g.y + 3} textAnchor="end" fontSize="9" fill="var(--ink-50)" fontFamily="var(--font-mono)">{g.v}</text>
        </g>
      ))}
      <path d={areaPath} fill="var(--accent)" opacity="0.10" />
      <path d={linePath} fill="none" stroke="var(--accent)" strokeWidth="1.75" />
      {values.length > 1 && (
        <>
          <circle cx={xs(peakIdx)} cy={ys(values[peakIdx])} r="4" fill="var(--accent)" stroke="var(--paper)" strokeWidth="2" />
          <text x={xs(peakIdx) + 8} y={ys(values[peakIdx]) + 3} fontSize="9" fill="var(--ink-70)" fontFamily="var(--font-mono)" fontWeight="600">PEAK {values[peakIdx]}</text>
        </>
      )}
      {xLabels.map((l, i) => (
        <text key={i} x={l.x} y={H - 5} fontSize="9" textAnchor="middle" fill="var(--ink-50)" fontFamily="var(--font-mono)">{l.label}</text>
      ))}
    </svg>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ReportPage() {
  const params = useParams<{ reportId: string }>();
  const [data, setData] = useState<ReportData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/reports/${params.reportId}`)
      .then((r) => r.ok ? r.json() : Promise.reject("not found"))
      .then(setData)
      .catch(() => setError("Report not found."));
  }, [params.reportId]);

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

  const { cluster, narratives, items, sourceBreakdown, velocityHistory } = data;

  const stage = cluster.narrativeStage ? cluster.narrativeStage.toUpperCase() : null;
  const effectiveClass = cluster.analystClassification ?? "narrative";
  const velocityDeltaLabel = velocityChange(cluster.velocity24h, cluster.prevVelocity24h);
  const velocityDeltaCls = velocityChangeCls(cluster.velocity24h, cluster.prevVelocity24h);
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
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
          <span style={{ display: "inline-flex", alignItems: "center", fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", padding: "3px 8px", borderRadius: 3, background: "var(--accent)", color: "#fff", textTransform: "uppercase" }}>
            SIGNAL
          </span>
          {stage && (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", padding: "3px 8px", borderRadius: 3, background: "color-mix(in oklch, var(--accent) 15%, transparent)", color: "var(--accent)" }}>
              {stage}
            </span>
          )}
          {effectiveClass && effectiveClass !== "narrative" && (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", padding: "3px 8px", borderRadius: 3, background: "color-mix(in oklch, var(--ok) 14%, transparent)", color: "var(--ok)", border: "1px solid color-mix(in oklch, var(--ok) 30%, transparent)" }}>
              {effectiveClass.toUpperCase()}
            </span>
          )}
        </div>

        <h1 style={{ fontSize: 36, fontWeight: 600, letterSpacing: "-0.025em", lineHeight: 1.05, margin: "0 0 24px", color: "var(--ink)" }}>
          {cluster.label ?? <span style={{ color: "var(--ink-40)", fontStyle: "italic" }}>Unnamed cluster</span>}
        </h1>

        {/* Metric row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", border: "1px solid var(--border)", borderRadius: 10, background: "var(--paper)", overflow: "hidden" }}>
          {/* Sentiment */}
          <div style={{ padding: "18px 22px", borderRight: "1px solid var(--border-soft)" }}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--ink-50)", marginBottom: 8 }}>Sentiment</div>
            {cluster.sentimentScore != null ? (
              <>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                  <span style={{ fontSize: 30, fontWeight: 600, letterSpacing: "-0.02em", lineHeight: 1, color: sentColor(cluster.sentimentScore), fontVariantNumeric: "tabular-nums" }}>
                    {cluster.sentimentScore >= 0 ? "+" : ""}{cluster.sentimentScore.toFixed(2)}
                  </span>
                  {cluster.sentimentLabel && (
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 500, padding: "2px 6px", borderRadius: 3, background: "color-mix(in oklch, var(--ink-50) 10%, transparent)", color: "var(--ink-60)" }}>
                      {cluster.sentimentLabel}
                    </span>
                  )}
                </div>
                <SentMiniBar value={cluster.sentimentScore} />
              </>
            ) : (
              <div style={{ fontSize: 30, fontWeight: 600, color: "var(--ink-30)" }}>—</div>
            )}
          </div>

          {/* Velocity */}
          <div style={{ padding: "18px 22px" }}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--ink-50)", marginBottom: 8 }}>Velocity</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
              <span style={{ fontSize: 30, fontWeight: 600, letterSpacing: "-0.02em", lineHeight: 1, color: "var(--ink)", fontVariantNumeric: "tabular-nums" }}>
                {cluster.velocity24h != null ? cluster.velocity24h.toFixed(1) : "—"}
                {cluster.velocity24h != null && <span style={{ color: "var(--ink-50)", fontSize: 13, fontWeight: 400, marginLeft: 4 }}>/day</span>}
              </span>
              {velocityDeltaLabel && (
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 500, padding: "2px 6px", borderRadius: 3, background: velocityDeltaCls === "metric-delta-err" ? "color-mix(in oklch, var(--err) 10%, transparent)" : "color-mix(in oklch, var(--ok) 10%, transparent)", color: velocityDeltaCls === "metric-delta-err" ? "var(--err)" : "var(--ok)" }}>
                  {velocityDeltaLabel}
                </span>
              )}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--ink-60)" }}>{cluster.itemCount} items total</div>
          </div>
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

      {/* ── Velocity chart + Source breakdown ──────────────────────────────── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontFamily: "var(--font-mono)", fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--ink-50)", padding: "0 0 8px", margin: "32px 0 14px", borderBottom: "1px solid var(--border-soft)" }}>
        <span>Velocity &amp; sources</span>
        <span style={{ fontSize: 10, color: "var(--ink-40)", letterSpacing: "0.06em" }}>snapshot · last 48h from generation</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 18 }}>
        {/* Velocity chart */}
        <div style={{ background: "var(--paper)", border: "1px solid var(--border)", borderRadius: 10, padding: "18px 20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em", color: "var(--ink)" }}>Items per hour</div>
            {velocityHistory.length > 0 && (
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--ink-50)" }}>
                peak {Math.max(...velocityHistory.map((b) => b.itemCount))} · avg {(velocityHistory.reduce((a, b) => a + b.itemCount, 0) / velocityHistory.length).toFixed(1)}/h
              </div>
            )}
          </div>
          <VelocityChart buckets={velocityHistory} />
          <div style={{ display: "flex", gap: 18, marginTop: 12, fontSize: 11.5, color: "var(--ink-60)" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: "var(--accent)", display: "inline-block" }} />
              Cluster volume
            </span>
          </div>
        </div>

        {/* Source breakdown */}
        <div style={{ background: "var(--paper)", border: "1px solid var(--border)", borderRadius: 10, padding: "18px 20px" }}>
          <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em", color: "var(--ink)", marginBottom: 16 }}>Source breakdown</div>
          {sourceBreakdown.length === 0 ? (
            <div style={{ color: "var(--ink-40)", fontFamily: "var(--font-mono)", fontSize: 11 }}>No data</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {sourceBreakdown.map((s) => {
                const p = getPlatform(s.platform);
                return (
                  <div key={s.platform} style={{ display: "grid", gridTemplateColumns: "90px 1fr 30px", gap: 10, alignItems: "center" }}>
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
          )}
        </div>
      </div>

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
