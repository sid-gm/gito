"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useCompany } from "@/components/CompanyContext";
import { cx, Dot, PlatformChip } from "@/components/primitives";
import { StagePill } from "@/components/StagePill";

// ─── Types ───────────────────────────────────────────────────────────────────

type ReportItem = { platform: string; title: string; time: string; author: string };

type ReportCluster = {
  id: string;
  label: string;
  short: string;
  stage: string;
  velocity: number;
  firstSeen: string;
  platforms: string[];
  x: number;
  y: number;
  hourly: number[]; // 24-element cumulative array
  sentiment: number;
  items: ReportItem[];
};

type DailyReportData = {
  date: string;
  day: string;
  dateKey: string;   // YYYY-MM-DD Pacific
  todayKey: string;  // today's YYYY-MM-DD Pacific
  tz: string;
  company: string;
  currentHour: number;
  clusters: ReportCluster[];
};

function shiftDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

// ─── Stage colors ─────────────────────────────────────────────────────────────

const STAGE_COLOR: Record<string, string> = {
  relaxed:    "#2563EB",
  emerging:   "oklch(0.62 0.13 150)",
  developing: "oklch(0.65 0.16 60)",
  peaked:     "oklch(0.72 0.14 75)",
  declining:  "oklch(0.60 0.18 25)",
  revival:    "#8B5CF6",
};

function stageColor(stage: string) {
  return STAGE_COLOR[stage] ?? STAGE_COLOR.relaxed;
}

// ─── Bubble constants ─────────────────────────────────────────────────────────

const VIEW_W = 1080;
const VIEW_H = 640;
const R_MIN = 36;

function getMaxRadius(n: number): number {
  if (n <= 2) return 200;
  if (n <= 4) return 180;
  if (n <= 6) return 155;
  return 130;
}

function radiusFor(count: number, maxFinal: number, rMax: number): number {
  if (count <= 0) return 0;
  const k = Math.sqrt(count / Math.max(maxFinal, 1));
  return R_MIN + (rMax - R_MIN) * k;
}

// Force simulation: push overlapping bubbles apart, attract toward center.
// Runs on final-hour radii so positions are stable during animation.
function solvePositions(
  clusters: ReportCluster[],
  maxFinal: number,
  rMax: number,
): Array<{ x: number; y: number }> {
  const n = clusters.length;
  const radii = clusters.map((c) =>
    radiusFor(c.hourly[c.hourly.length - 1] ?? 0, maxFinal, rMax),
  );
  const pos = clusters.map((c) => ({ x: c.x, y: c.y }));
  const CX = VIEW_W / 2, CY = VIEW_H / 2;
  const PAD = 8;

  for (let iter = 0; iter < 500; iter++) {
    const attract = 0.018 * Math.pow(1 - iter / 500, 1.5);

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = pos[j].x - pos[i].x;
        const dy = pos[j].y - pos[i].y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
        const minDist = radii[i] + radii[j] + PAD;
        if (dist < minDist) {
          const push = (minDist - dist) / 2 + 0.5;
          const nx = dx / dist, ny = dy / dist;
          pos[i].x -= nx * push;
          pos[i].y -= ny * push;
          pos[j].x += nx * push;
          pos[j].y += ny * push;
        }
      }
    }

    for (let i = 0; i < n; i++) {
      pos[i].x += (CX - pos[i].x) * attract;
      pos[i].y += (CY - pos[i].y) * attract;
    }
  }

  for (let i = 0; i < n; i++) {
    const r = radii[i] + 4;
    pos[i].x = Math.max(r, Math.min(VIEW_W - r, pos[i].x));
    pos[i].y = Math.max(r, Math.min(VIEW_H - r, pos[i].y));
  }

  return pos;
}

function bubbleFontSize(r: number): number {
  if (r >= 160) return 28;
  if (r >= 110) return 22;
  if (r >= 80) return 17;
  if (r >= 55) return 13;
  return 11;
}

// ─── Animation hook ───────────────────────────────────────────────────────────

function useAnimatedHour(maxHour: number) {
  const [hour, setHour] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    if (!playing) return;
    if (hour >= maxHour) { setPlaying(false); setCompleted(true); return; }
    const dwell = hour < 3 ? 360 : 280;
    const t = setTimeout(() => setHour((h) => Math.min(maxHour, h + 1)), dwell);
    return () => clearTimeout(t);
  }, [playing, hour, maxHour]);

  const replay = useCallback(() => { setHour(0); setCompleted(false); setPlaying(true); }, []);
  const toggle = useCallback(() => {
    if (completed) { replay(); return; }
    setPlaying((p) => !p);
  }, [completed, replay]);
  const scrub = useCallback((h: number) => { setHour(h); setPlaying(false); setCompleted(h >= maxHour); }, [maxHour]);

  return { hour, playing, completed, toggle, scrub, replay };
}

// ─── BubbleGraph ──────────────────────────────────────────────────────────────

function DRBubble({
  cluster, pos, currentHour, maxFinal, rMax, selectedId, onSelect, anyHovered, hovered, onHover,
}: {
  cluster: ReportCluster;
  pos: { x: number; y: number };
  currentHour: number;
  maxFinal: number;
  rMax: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  anyHovered: boolean;
  hovered: boolean;
  onHover: (id: string | null) => void;
}) {
  const count = cluster.hourly[currentHour] ?? 0;
  const r = radiusFor(count, maxFinal, rMax);
  const color = stageColor(cluster.stage);
  const selected = selectedId === cluster.id;
  const dim = (!!selectedId && !selected) || (anyHovered && !hovered);
  const fill = `color-mix(in oklch, ${color} 12%, var(--paper))`;
  const labelFs = bubbleFontSize(r);
  const showLabel = r >= 32;
  const showCount = r >= 56;
  const delta = currentHour > 0 ? count - (cluster.hourly[currentHour - 1] ?? 0) : 0;

  return (
    <g
      transform={`translate(${pos.x}, ${pos.y})`}
      style={{ opacity: dim ? 0.32 : 1, transition: "opacity 180ms ease" }}
      onMouseEnter={() => onHover(cluster.id)}
      onMouseLeave={() => onHover(null)}
    >
      <circle
        className="dr-bubble-circle"
        r={Math.max(0, r)}
        fill={fill}
        stroke={color}
        strokeWidth={selected ? 3.5 : 1.6}
        onClick={() => onSelect(cluster.id)}
      />
      {/* Larger invisible hit zone so small bubbles stay clickable */}
      <circle
        r={Math.max(r, 28)}
        fill="transparent"
        style={{ cursor: "pointer" }}
        onClick={() => onSelect(cluster.id)}
        onMouseEnter={() => onHover(cluster.id)}
        onMouseLeave={() => onHover(null)}
      />
      {r > 14 && (
        <foreignObject x={-r} y={-r} width={r * 2} height={r * 2} style={{ pointerEvents: "none" }}>
          <div
            className={cx("dr-bubble-label", showLabel && "dr-bubble-label-visible")}
            style={{ fontSize: labelFs } as React.CSSProperties}
          >
            <div className="dr-bubble-label-title" style={{ fontSize: labelFs }}>
              {r >= 70 ? cluster.label : cluster.short}
            </div>
            {showCount && <div className="dr-bubble-label-count">{count} items</div>}
            {showCount && delta > 0 && (
              <div className="dr-bubble-label-delta dr-bubble-label-delta-on">↑ +{delta} this hour</div>
            )}
          </div>
        </foreignObject>
      )}
    </g>
  );
}

function DRBubbleGraph({ clusters, currentHour, selectedId, onSelect }: {
  clusters: ReportCluster[];
  currentHour: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const maxFinal = useMemo(
    () => Math.max(...clusters.map((c) => c.hourly[c.hourly.length - 1] ?? 0), 1),
    [clusters],
  );
  const rMax = getMaxRadius(clusters.length);
  // Positions are stable — computed once from final radii so bubbles don't jump during playback.
  const positions = useMemo(
    () => solvePositions(clusters, maxFinal, rMax),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clusters],
  );

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className="dr-bubble-svg"
      preserveAspectRatio="xMidYMid meet"
    >
      {clusters.map((c, i) => (
        <DRBubble
          key={c.id}
          cluster={c}
          pos={positions[i] ?? { x: c.x, y: c.y }}
          currentHour={currentHour}
          maxFinal={maxFinal}
          rMax={rMax}
          selectedId={selectedId}
          onSelect={onSelect}
          anyHovered={!!hovered}
          hovered={hovered === c.id}
          onHover={setHovered}
        />
      ))}
    </svg>
  );
}

// ─── Timeline ─────────────────────────────────────────────────────────────────

function DRTimeline({ currentHour, maxHour, onScrub, playing, tz }: {
  currentHour: number;
  maxHour: number;
  onScrub: (h: number) => void;
  playing: boolean;
  tz: string;
}) {
  const ticks = Array.from({ length: 24 }, (_, i) => i);
  const hh = currentHour.toString().padStart(2, "0");
  return (
    <div className="dr-card-foot">
      <div className="dr-tl-head">
        <div className="dr-tl-label">Hourly cron · 24h timeline</div>
        <div className="dr-tl-clock">
          {playing
            ? <Dot color="var(--accent)" pulse />
            : <span style={{ width: 6, height: 6, background: "var(--ink-30)", borderRadius: "50%", display: "inline-block" }} />
          }
          <span>{hh}:00 {tz}</span>
        </div>
      </div>
      <div className="dr-tl-bar">
        {ticks.map((h) => {
          const isFuture = h > maxHour;
          const isPast = h < currentHour && !isFuture;
          const isNow = h === currentHour;
          return (
            <button
              key={h}
              className={cx(
                "dr-tl-tick",
                isPast && "dr-tl-tick-on",
                isNow && "dr-tl-tick-now",
                isFuture && "dr-tl-tick-future",
              )}
              onClick={() => !isFuture && onScrub(h)}
              title={`${h.toString().padStart(2, "0")}:00`}
              disabled={isFuture}
            >
              {h % 6 === 0 && (
                <span className="dr-tl-tick-label">{h.toString().padStart(2, "0")}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Cluster Detail ───────────────────────────────────────────────────────────

function DRStat({ label, value, unit }: { label: string; value: React.ReactNode; unit?: string }) {
  return (
    <div className="dr-stat">
      <div className="dr-stat-label">{label}</div>
      <div className="dr-stat-value">
        <span>{value}</span>
        {unit && <span className="dr-stat-unit">{unit}</span>}
      </div>
    </div>
  );
}

function DRClusterDetail({ cluster, onClose }: { cluster: ReportCluster; onClose: () => void }) {
  const finalCount = cluster.hourly[cluster.hourly.length - 1] ?? 0;
  const color = stageColor(cluster.stage);
  const sentColor = cluster.sentiment > 0.25 ? "var(--ok)" : cluster.sentiment < -0.25 ? "var(--err)" : "var(--ink-60)";
  const sentLabel = cluster.sentiment > 0.25 ? "positive" : cluster.sentiment < -0.25 ? "negative" : "mixed";

  return (
    <section className="dr-detail">
      <div className="dr-detail-head">
        <div className="dr-detail-id">
          <StagePill stage={cluster.stage} />
          <div className="dr-detail-title">{cluster.label}</div>
        </div>
        <button className="dr-detail-close" onClick={onClose} aria-label="Close">✕</button>
      </div>

      <div className="dr-detail-stats">
        <DRStat label="Items today" value={finalCount} unit="items" />
        <DRStat label="Velocity" value={cluster.velocity.toFixed(1)} unit="items/h" />
        <DRStat label="First seen" value={cluster.firstSeen} unit="UTC" />
        <DRStat label="Sentiment" value={<span style={{ color: sentColor }}>{sentLabel}</span>} unit={cluster.sentiment.toFixed(2)} />
      </div>

      <div className="dr-detail-items">
        {cluster.items.length === 0 ? (
          <div style={{ padding: "20px", textAlign: "center", color: "var(--ink-40)", fontFamily: "var(--font-mono)", fontSize: 11 }}>
            No items yet today
          </div>
        ) : (
          cluster.items.map((it, i) => (
            <div key={i} className="dr-item" style={{ color }}>
              <span className="dr-item-rail" />
              <div className="dr-item-time">{it.time}</div>
              <div className="dr-item-platform">
                <PlatformChip platform={it.platform} size="sm" />
              </div>
              <div className="dr-item-title">{it.title}</div>
              <div className="dr-item-author">{it.author}</div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DailyReportPage() {
  const { activeCompanyId } = useCompany();
  const [data, setData] = useState<DailyReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewDate, setViewDate] = useState<string | null>(null); // null = today

  useEffect(() => {
    if (!activeCompanyId) return;
    setLoading(true);
    const qs = viewDate
      ? `companyId=${activeCompanyId}&date=${viewDate}`
      : `companyId=${activeCompanyId}`;
    fetch(`/api/daily-report?${qs}`)
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, [activeCompanyId, viewDate]);

  const clusters = data?.clusters ?? [];
  const maxHour = data?.currentHour ?? 0;

  const { hour, playing, completed, toggle, scrub, replay } = useAnimatedHour(maxHour);

  // Reset animation whenever we navigate to a different day
  const dateKey = data?.dateKey;
  useEffect(() => {
    if (dateKey) replay();
  }, [dateKey, replay]);

  const ranked = useMemo(
    () => [...clusters].sort((a, b) => (b.hourly[hour] ?? 0) - (a.hourly[hour] ?? 0)),
    [clusters, hour],
  );

  const top = ranked[0] ?? null;
  const totalNow = clusters.reduce((s, c) => s + (c.hourly[hour] ?? 0), 0);
  const clustersActiveNow = clusters.filter((c) => (c.hourly[hour] ?? 0) > 0).length;
  const selected = selectedId ? clusters.find((c) => c.id === selectedId) ?? null : null;

  const onReplay = () => { setSelectedId(null); replay(); };

  if (loading) {
    return (
      <>
        <header className="topbar">
          <div>
            <div className="eyebrow">Part 6 · Publish</div>
            <h1 className="page-title">Daily report</h1>
          </div>
        </header>
        <div className="dr-page">
          <div className="empty">
            <div className="empty-mark">◐</div>
            <div className="empty-title">Loading daily report…</div>
          </div>
        </div>
      </>
    );
  }

  if (!data || clusters.length === 0) {
    return (
      <>
        <header className="topbar">
          <div>
            <div className="eyebrow">Part 6 · Publish</div>
            <h1 className="page-title">Daily report</h1>
            <p className="page-desc">A shareable snapshot of clusters formed today, sized by item count.</p>
          </div>
        </header>
        <div className="dr-page">
          <div className="empty">
            <div className="empty-mark">◐</div>
            <div className="empty-title">No clusters yet today</div>
            <div className="empty-sub">Clusters will appear here as items are ingested and grouped.</div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <header className="topbar">
        <div>
          <div className="eyebrow">Part 6 · Publish</div>
          <h1 className="page-title">Daily report</h1>
          <p className="page-desc">
            A shareable snapshot of the clusters that formed today, sized by item count and stepped through hour by hour.
          </p>
        </div>
        <div className="topbar-actions">
          <button className="btn">↗ Embed</button>
          <button className="btn">⇣ PNG</button>
          <button className="btn btn-primary">⇣ MP4 · 1080×1080</button>
        </div>
      </header>

      <div className="dr-page">
        {/* Date strip */}
        <div className="dr-datebar">
          <div className="dr-date-nav">
            <button
              className="dr-date-step"
              title="Previous day"
              onClick={() => setViewDate(shiftDate(data.dateKey, -1))}
            >←</button>
            <div className="dr-date-title">
              {data.date}
              <span className="dr-date-tz">{data.day.toUpperCase()} · {data.tz}</span>
            </div>
            <button
              className="dr-date-step"
              title={data.dateKey >= data.todayKey ? "Tomorrow — not yet polled" : "Next day"}
              disabled={data.dateKey >= data.todayKey}
              onClick={() => {
                const next = shiftDate(data.dateKey, 1);
                setViewDate(next >= data.todayKey ? null : next);
              }}
            >→</button>
          </div>
          <div className="dr-toolbar">
            <span className="dr-share-status">
              <Dot color="var(--ok)" pulse />
              auto-published {maxHour.toString().padStart(2, "0")}:00 {data.tz}
            </span>
          </div>
        </div>

        {/* Two-column layout */}
        <div className="dr-stage">
          {/* Left: artwork */}
          <div>
            <div className="dr-card-wrap">
              <div className="dr-card-rail" />
              <div className="dr-card">
                {/* Artwork header */}
                <div className="dr-card-head">
                  <div className="dr-card-id">
                    <div className="dr-card-mark"><span>GT</span></div>
                    <div>
                      <div className="dr-card-eyebrow">Daily signal brief · {data.date}</div>
                      <div className="dr-card-title">{data.company} · cluster formation</div>
                    </div>
                  </div>
                  <div className="dr-card-meta">
                    <span className="dr-card-meta-stat">
                      <span className="dr-card-meta-stat-num">{totalNow}</span>
                      <span>items · {clustersActiveNow}/{clusters.length} clusters</span>
                    </span>
                    <span>polled hourly · deduplicated on ingest</span>
                  </div>
                </div>

                {/* Bubble graph */}
                <div className="dr-bubble-area">
                  <DRBubbleGraph
                    clusters={clusters}
                    currentHour={hour}
                    selectedId={selectedId}
                    onSelect={(id) => setSelectedId((prev) => (prev === id ? null : id))}
                  />
                </div>

                {/* Timeline */}
                <DRTimeline
                  currentHour={hour}
                  maxHour={maxHour}
                  onScrub={scrub}
                  playing={playing}
                  tz={data.tz}
                />
              </div>
            </div>

            {/* Play controls */}
            <div className="dr-card-controls">
              <button className="dr-ctrl-btn" onClick={toggle}>
                <span className="dr-ctrl-glyph">{playing ? "▮▮" : completed ? "↻" : "▶"}</span>
                <span>{playing ? "Pause" : completed ? "Replay" : "Play"}</span>
              </button>
              <button className="dr-ctrl-btn" onClick={onReplay}>
                <span className="dr-ctrl-glyph">↻</span>
                <span>Restart</span>
              </button>
              <div className="dr-ctrl-sep" />
              <span>scrub the timeline above to inspect any hour · click a bubble to see its items</span>
            </div>
          </div>

          {/* Right rail */}
          <aside className="dr-side">
            {top && (
              <div className="dr-headline">
                <div className="dr-side-eyebrow dr-headline-eyebrow">Top signal today</div>
                <div className="dr-headline-title">{top.label}</div>
                <div className="dr-headline-meta">
                  <span><strong>{top.hourly[hour] ?? 0}</strong> items</span>
                  <span>· {top.platforms.length} platforms</span>
                  <span>· first seen <strong>{top.firstSeen}</strong></span>
                  <span>· velocity <strong>{top.velocity.toFixed(1)}/h</strong></span>
                </div>
              </div>
            )}

            <div className="dr-side-card">
              <div className="dr-side-eyebrow">Clusters · ranked by volume</div>
              <div className="dr-legend-list">
                {ranked.map((c) => {
                  const color = stageColor(c.stage);
                  const isOn = selectedId === c.id;
                  const count = c.hourly[hour] ?? 0;
                  return (
                    <button
                      key={c.id}
                      className={cx("dr-legend-row", isOn && "dr-legend-row-on")}
                      style={{ color } as React.CSSProperties}
                      onClick={() => setSelectedId((prev) => (prev === c.id ? null : c.id))}
                    >
                      <span className="dr-legend-dot" />
                      <span className="dr-legend-label">{c.label}</span>
                      <span className="dr-legend-meta">
                        {count} · <StagePill stage={c.stage} />
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="dr-side-card">
              <div className="dr-side-eyebrow">How it&apos;s built</div>
              <div style={{ fontSize: 13, color: "var(--ink-70)", lineHeight: 1.5 }}>
                The hourly cron polls all platforms, deduplicates new items on ingest, and re-runs cluster assignment. The bubbles redraw whenever cluster cardinality changes.
              </div>
            </div>
          </aside>
        </div>

        {/* Detail panel */}
        {selected && (
          <DRClusterDetail cluster={selected} onClose={() => setSelectedId(null)} />
        )}
      </div>
    </>
  );
}
