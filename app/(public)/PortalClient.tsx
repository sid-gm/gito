"use client";

import { Suspense, useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { cx, Dot, PlatformChip } from "@/components/primitives";
import { StagePill } from "@/components/StagePill";
import { NewsTimeline } from "@/components/news-timeline/TimelineTrack";
import { DayDetailDrawer } from "@/components/news-timeline/DayDetailDrawer";
import type {
  NtlTimelineData, HoverPopState, NtlFeed, NtlDay, SelectedDayState,
} from "@/components/news-timeline/timeline_core";
import "./portal.css";

// ─── Types ───────────────────────────────────────────────────────────────────

type Company = { id: string; name: string; createdAt: string };

type ReportItem = { platform: string; title: string; time: string; author: string };

type ReportCluster = {
  id: string; label: string; short: string; stage: string;
  velocity: number; firstSeen: string; platforms: string[];
  x: number; y: number; hourly: number[]; sentiment: number;
  items: ReportItem[];
};

type DailyData = {
  date: string; day: string; dateKey: string; todayKey: string;
  tz: string; company: string; currentHour: number;
  generatedAt?: string; clusters: ReportCluster[];
};

type NarrativeItem = {
  id: string; label: string; narrativeStage: string;
  narrativeSummary: string | null; momentum: number | null;
  velocity24h: number | null; sentimentLabel: string | null;
  sentimentScore: number | null; itemCount: number;
  firstSeenAt: string; lastSeenAt: string; platformCount: number | null;
};

type SignalBrief = {
  id: string; title: string; url: string | null; platform: string;
  publishedAt: string | null; author: string | null;
  clusterLabel: string | null; narrativeStage: string | null;
};

type PublicReport = {
  id: string; clusterLabel: string; companyName: string | null; generatedAt: string;
};

// ─── Stage constants ──────────────────────────────────────────────────────────

const STAGE_COLOR: Record<string, string> = {
  relaxed: "#2563EB", emerging: "oklch(0.62 0.13 150)",
  developing: "oklch(0.65 0.16 60)", peaked: "oklch(0.72 0.14 75)",
  declining: "oklch(0.60 0.18 25)", revival: "#8B5CF6",
};
const STAGE_ORDER = ["peaked", "developing", "emerging", "revival", "relaxed", "declining"];

function stageColor(s: string) { return STAGE_COLOR[s] ?? STAGE_COLOR.relaxed; }

// ─── Bubble graph constants ───────────────────────────────────────────────────

const VIEW_W = 1080, VIEW_H = 640, R_MIN = 36;

function getMaxRadius(n: number) {
  return n <= 2 ? 200 : n <= 4 ? 180 : n <= 6 ? 155 : 130;
}

function radiusFor(count: number, maxFinal: number, rMax: number): number {
  if (count <= 0) return 0;
  return R_MIN + (rMax - R_MIN) * Math.sqrt(count / Math.max(maxFinal, 1));
}

function solvePositions(clusters: ReportCluster[], maxFinal: number, rMax: number) {
  const n = clusters.length;
  const radii = clusters.map((c) => radiusFor(c.hourly[c.hourly.length - 1] ?? 0, maxFinal, rMax));
  const pos = clusters.map((c) => ({ x: c.x, y: c.y }));
  const CX = VIEW_W / 2, CY = VIEW_H / 2;
  for (let iter = 0; iter < 500; iter++) {
    const attract = 0.018 * Math.pow(1 - iter / 500, 1.5);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = pos[j].x - pos[i].x, dy = pos[j].y - pos[i].y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
        const minDist = radii[i] + radii[j] + 8;
        if (dist < minDist) {
          const push = (minDist - dist) / 2 + 0.5;
          const nx = dx / dist, ny = dy / dist;
          pos[i].x -= nx * push; pos[i].y -= ny * push;
          pos[j].x += nx * push; pos[j].y += ny * push;
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

function bubbleFontSize(r: number) {
  return r >= 160 ? 28 : r >= 110 ? 22 : r >= 80 ? 17 : r >= 55 ? 13 : 11;
}

// ─── Animation hook ───────────────────────────────────────────────────────────

function useAnimatedHour(maxHour: number) {
  const [hour, setHour] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [completed, setCompleted] = useState(false);
  useEffect(() => {
    if (!playing) return;
    if (hour >= maxHour) { setPlaying(false); setCompleted(true); return; }
    const t = setTimeout(() => setHour((h) => Math.min(maxHour, h + 1)), hour < 3 ? 360 : 280);
    return () => clearTimeout(t);
  }, [playing, hour, maxHour]);
  const replay = useCallback(() => { setHour(0); setCompleted(false); setPlaying(true); }, []);
  const toggle = useCallback(() => { if (completed) { replay(); return; } setPlaying((p) => !p); }, [completed, replay]);
  const scrub = useCallback((h: number) => { setHour(h); setPlaying(false); setCompleted(h >= maxHour); }, [maxHour]);
  return { hour, playing, completed, toggle, scrub, replay };
}

// ─── DRBubble ─────────────────────────────────────────────────────────────────

function DRBubble({
  cluster, pos, currentHour, maxFinal, rMax, selectedId, onSelect, anyHovered, hovered, onHover,
}: {
  cluster: ReportCluster; pos: { x: number; y: number };
  currentHour: number; maxFinal: number; rMax: number;
  selectedId: string | null; onSelect: (id: string) => void;
  anyHovered: boolean; hovered: boolean; onHover: (id: string | null) => void;
}) {
  const count = cluster.hourly[currentHour] ?? 0;
  const r = radiusFor(count, maxFinal, rMax);
  const color = stageColor(cluster.stage);
  const selected = selectedId === cluster.id;
  const dim = (!!selectedId && !selected) || (anyHovered && !hovered);
  const labelFs = bubbleFontSize(r);
  const delta = currentHour > 0 ? count - (cluster.hourly[currentHour - 1] ?? 0) : 0;
  return (
    <g transform={`translate(${pos.x},${pos.y})`}
      style={{ opacity: dim ? 0.32 : 1, transition: "opacity 180ms ease" }}
      onMouseEnter={() => onHover(cluster.id)} onMouseLeave={() => onHover(null)}>
      <circle className="dr-bubble-circle" r={Math.max(0, r)}
        fill={`color-mix(in oklch, ${color} 12%, var(--paper))`}
        stroke={color} strokeWidth={selected ? 3.5 : 1.6}
        onClick={() => onSelect(cluster.id)} />
      <circle r={Math.max(r, 28)} fill="transparent" style={{ cursor: "pointer" }}
        onClick={() => onSelect(cluster.id)}
        onMouseEnter={() => onHover(cluster.id)} onMouseLeave={() => onHover(null)} />
      {r > 14 && (
        <foreignObject x={-r} y={-r} width={r * 2} height={r * 2} style={{ pointerEvents: "none" }}>
          <div className={cx("dr-bubble-label", r >= 32 && "dr-bubble-label-visible")} style={{ fontSize: labelFs } as React.CSSProperties}>
            <div className="dr-bubble-label-title" style={{ fontSize: labelFs }}>
              {r >= 70 ? cluster.label : cluster.short}
            </div>
            {r >= 56 && <div className="dr-bubble-label-count">{count} items</div>}
            {r >= 56 && delta > 0 && <div className="dr-bubble-label-delta dr-bubble-label-delta-on">↑ +{delta} this hour</div>}
          </div>
        </foreignObject>
      )}
    </g>
  );
}

// ─── DRBubbleGraph ────────────────────────────────────────────────────────────

function DRBubbleGraph({ clusters, currentHour, selectedId, onSelect }: {
  clusters: ReportCluster[]; currentHour: number;
  selectedId: string | null; onSelect: (id: string) => void;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const maxFinal = useMemo(() => Math.max(...clusters.map((c) => c.hourly[c.hourly.length - 1] ?? 0), 1), [clusters]);
  const rMax = getMaxRadius(clusters.length);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const positions = useMemo(() => solvePositions(clusters, maxFinal, rMax), [clusters]);
  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="dr-bubble-svg" preserveAspectRatio="xMidYMid meet">
      {clusters.map((c, i) => (
        <DRBubble key={c.id} cluster={c} pos={positions[i] ?? { x: c.x, y: c.y }}
          currentHour={currentHour} maxFinal={maxFinal} rMax={rMax}
          selectedId={selectedId} onSelect={onSelect}
          anyHovered={!!hovered} hovered={hovered === c.id} onHover={setHovered} />
      ))}
    </svg>
  );
}

// ─── DRTimeline ───────────────────────────────────────────────────────────────

function DRTimeline({ currentHour, maxHour, onScrub, playing, tz }: {
  currentHour: number; maxHour: number; onScrub: (h: number) => void; playing: boolean; tz: string;
}) {
  return (
    <div className="dr-card-foot">
      <div className="dr-tl-head">
        <div className="dr-tl-label">Hourly cron · 24h timeline</div>
        <div className="dr-tl-clock">
          {playing
            ? <Dot color="var(--accent)" pulse />
            : <span style={{ width: 6, height: 6, background: "var(--ink-30)", borderRadius: "50%", display: "inline-block" }} />}
          <span>{currentHour.toString().padStart(2, "0")}:00 {tz}</span>
        </div>
      </div>
      <div className="dr-tl-bar">
        {Array.from({ length: 24 }, (_, h) => {
          const isFuture = h > maxHour;
          return (
            <button key={h}
              className={cx("dr-tl-tick", h < currentHour && !isFuture && "dr-tl-tick-on", h === currentHour && "dr-tl-tick-now", isFuture && "dr-tl-tick-future")}
              onClick={() => !isFuture && onScrub(h)} title={`${h.toString().padStart(2, "0")}:00`} disabled={isFuture}>
              {h % 6 === 0 && <span className="dr-tl-tick-label">{h.toString().padStart(2, "0")}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── DRClusterDetail ─────────────────────────────────────────────────────────

function DRClusterDetail({ cluster, onClose }: { cluster: ReportCluster; onClose: () => void }) {
  const finalCount = cluster.hourly[cluster.hourly.length - 1] ?? 0;
  const color = stageColor(cluster.stage);
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
        {[
          { label: "Items today", value: finalCount, unit: "items" },
          { label: "Velocity", value: cluster.velocity.toFixed(1), unit: "items/h" },
          { label: "First seen", value: cluster.firstSeen, unit: "UTC" },
          { label: "Sentiment", value: sentLabel, unit: cluster.sentiment.toFixed(2) },
        ].map((s) => (
          <div key={s.label} className="dr-stat">
            <div className="dr-stat-label">{s.label}</div>
            <div className="dr-stat-value"><span>{s.value}</span>{s.unit && <span className="dr-stat-unit">{s.unit}</span>}</div>
          </div>
        ))}
      </div>
      <div className="dr-detail-items">
        {cluster.items.length === 0 ? (
          <div style={{ padding: "20px", textAlign: "center", color: "var(--ink-40)", fontFamily: "var(--font-mono)", fontSize: 11 }}>No items yet today</div>
        ) : cluster.items.map((it, i) => (
          <div key={i} className="dr-item" style={{ color }}>
            <span className="dr-item-rail" />
            <div className="dr-item-time">{it.time}</div>
            <div className="dr-item-platform"><PlatformChip platform={it.platform} size="sm" /></div>
            <div className="dr-item-title">{it.title}</div>
            <div className="dr-item-author">{it.author}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "")).toUpperCase();
}

function todayPacific() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

function shiftDate(dateStr: string, days: number) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function fmtLabel(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m-1]} ${d}, ${y}`;
}

function relTime(iso: string | null) {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

// ─── Section: Daily brief ─────────────────────────────────────────────────────

function DailyBriefSection({ companyId, date, onDateChange, dateRange }: {
  companyId: string; date: string; onDateChange: (d: string) => void; dateRange: string[];
}) {
  const [data, setData] = useState<DailyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setSelectedId(null);
    fetch(`/api/public/daily-report?companyId=${companyId}&date=${date}`)
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, [companyId, date]);

  const clusters = data?.clusters ?? [];
  const maxHour = data?.currentHour ?? 0;
  const { hour, playing, completed, toggle, scrub, replay } = useAnimatedHour(maxHour);

  useEffect(() => { if (data) replay(); }, [data?.dateKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const ranked = useMemo(() => [...clusters].sort((a, b) => (b.hourly[hour] ?? 0) - (a.hourly[hour] ?? 0)), [clusters, hour]);
  const top = ranked[0] ?? null;
  const totalNow = clusters.reduce((s, c) => s + (c.hourly[hour] ?? 0), 0);
  const activeCount = clusters.filter((c) => (c.hourly[hour] ?? 0) > 0).length;
  const selected = selectedId ? clusters.find((c) => c.id === selectedId) ?? null : null;
  const today = todayPacific();
  const dateIdx = dateRange.indexOf(date);

  return (
    <section className="pp-section">
      <div className="pp-shead">
        <div className="pp-shead-l">
          <span className="pp-shead-num">01</span>
          <span className="pp-shead-title">Daily brief</span>
          <span className="pp-shead-desc">
            {data ? `clusters that formed on ${data.date}` : "cluster formation by hour"}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          {data && (
            <span className="pp-shead-meta">
              {totalNow} items · {data.tz}
              {data.dateKey === today ? ` · cron through ${String(maxHour).padStart(2,"0")}:00` : " · full day"}
            </span>
          )}
          {/* Date stepper */}
          <div className="pp-date">
            <span className="pp-date-label">Daily brief · adjust date</span>
            <div className="pp-date-ctrl">
              <button className="pp-date-step" onClick={() => dateIdx > 0 && onDateChange(dateRange[dateIdx - 1])} disabled={dateIdx <= 0}>←</button>
              <div className="pp-date-now">
                <span className="pp-date-now-main">{fmtLabel(date)}</span>
                <span className="pp-date-now-sub">{date === today ? "Today · PT" : "PT"}</span>
              </div>
              <button className="pp-date-step" onClick={() => dateIdx < dateRange.length - 1 && onDateChange(dateRange[dateIdx + 1])} disabled={dateIdx >= dateRange.length - 1}>→</button>
            </div>
            <div className="pp-date-pips">
              {dateRange.map((d, i) => (
                <button key={d} className={cx("pp-date-pip", d === date && "pp-date-pip-on", d === today && d !== date && "pp-date-pip-today")}
                  onClick={() => onDateChange(d)} title={fmtLabel(d)} />
              ))}
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="pp-empty"><div className="pp-empty-mark">◐</div><div className="pp-empty-title">Loading…</div></div>
      ) : clusters.length === 0 ? (
        <div className="pp-empty"><div className="pp-empty-mark">∅</div><div className="pp-empty-title">No clusters on this day</div></div>
      ) : (
        <>
          <div className="dr-stage">
            <div>
              <div className="dr-card-wrap">
                <div className="dr-card-rail" />
                <div className="dr-card">
                  <div className="dr-card-head">
                    <div className="dr-card-id">
                      <div className="dr-card-mark"><span>GT</span></div>
                      <div>
                        <div className="dr-card-eyebrow">Daily signal brief · {data?.date}</div>
                        <div className="dr-card-title">{data?.company} · cluster formation</div>
                      </div>
                    </div>
                    <div className="dr-card-meta">
                      <span className="dr-card-meta-stat">
                        <span className="dr-card-meta-stat-num">{totalNow}</span>
                        <span>items · {activeCount}/{clusters.length} clusters</span>
                      </span>
                      <span>polled hourly · deduplicated on ingest</span>
                    </div>
                  </div>
                  <div className="dr-bubble-area">
                    <DRBubbleGraph clusters={clusters} currentHour={hour} selectedId={selectedId}
                      onSelect={(id) => setSelectedId((prev) => prev === id ? null : id)} />
                  </div>
                  <DRTimeline currentHour={hour} maxHour={maxHour} onScrub={scrub} playing={playing} tz={data?.tz ?? "PT"} />
                </div>
              </div>
              <div className="dr-card-controls">
                <button className="dr-ctrl-btn" onClick={toggle}>
                  <span className="dr-ctrl-glyph">{playing ? "▮▮" : completed ? "↻" : "▶"}</span>
                  <span>{playing ? "Pause" : completed ? "Replay" : "Play"}</span>
                </button>
                <button className="dr-ctrl-btn" onClick={() => { setSelectedId(null); replay(); }}>
                  <span className="dr-ctrl-glyph">↻</span><span>Restart</span>
                </button>
                <div className="dr-ctrl-sep" />
                <span>scrub the timeline to inspect any hour · click a bubble to read its items</span>
              </div>
            </div>

            <aside className="dr-side">
              {top && (
                <div className="dr-headline">
                  <div className="dr-side-eyebrow dr-headline-eyebrow">Top signal · {date === today ? "today" : fmtLabel(date)}</div>
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
                    return (
                      <button key={c.id} className={cx("dr-legend-row", selectedId === c.id && "dr-legend-row-on")}
                        style={{ color } as React.CSSProperties}
                        onClick={() => setSelectedId((prev) => prev === c.id ? null : c.id)}>
                        <span className="dr-legend-dot" />
                        <span className="dr-legend-label">{c.label}</span>
                        <span className="dr-legend-meta">{c.hourly[hour] ?? 0} · <StagePill stage={c.stage} /></span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="dr-side-card">
                <div className="dr-side-eyebrow">How to read this</div>
                <div style={{ fontSize: 13, color: "var(--ink-70)", lineHeight: 1.5 }}>
                  Each bubble is a cluster of related items, sized by how many landed that day. The hourly cron polls all platforms, deduplicates on ingest, and re-runs clustering.
                </div>
              </div>
            </aside>
          </div>
          {selected && <DRClusterDetail cluster={selected} onClose={() => setSelectedId(null)} />}
        </>
      )}
    </section>
  );
}

// ─── Section: Global narratives (cards) ───────────────────────────────────────

function NarrativesSection({ companyId }: { companyId: string }) {
  const [narratives, setNarratives] = useState<NarrativeItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/public/narratives?companyId=${companyId}`)
      .then((r) => r.json())
      .then((d) => { setNarratives(d.narratives ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [companyId]);

  const sorted = useMemo(() =>
    [...narratives].sort((a, b) => STAGE_ORDER.indexOf(a.narrativeStage) - STAGE_ORDER.indexOf(b.narrativeStage)),
    [narratives]);

  const maxMomentum = useMemo(() => Math.max(...narratives.map((n) => n.momentum ?? 0), 1), [narratives]);

  return (
    <section className="pp-section">
      <div className="pp-shead">
        <div className="pp-shead-l">
          <span className="pp-shead-num">02</span>
          <span className="pp-shead-title">Global narratives</span>
          <span className="pp-shead-desc">active narrative clusters, sorted by stage</span>
        </div>
        {narratives.length > 0 && (
          <span className="pp-shead-meta">{narratives.length} narratives · sorted by stage</span>
        )}
      </div>

      {loading ? (
        <div className="pp-empty"><div className="pp-empty-mark">◈</div><div className="pp-empty-title">Loading…</div></div>
      ) : sorted.length === 0 ? (
        <div className="pp-empty"><div className="pp-empty-mark">∅</div><div className="pp-empty-title">No classified narratives yet</div></div>
      ) : (
        <div className="pp-narrative-grid">
          {sorted.map((n) => {
            const color = stageColor(n.narrativeStage);
            const pct = Math.round(((n.momentum ?? 0) / maxMomentum) * 100);
            const sentColor = (n.sentimentScore ?? 0) > 0.2 ? "var(--ok)" : (n.sentimentScore ?? 0) < -0.2 ? "var(--err)" : "var(--ink-50)";
            return (
              <div key={n.id} className="pp-narrative-card">
                <div className="pp-narrative-card-rail" style={{ background: color }} />
                <div className="pp-narrative-stage">
                  <StagePill stage={n.narrativeStage} />
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-40)", letterSpacing: "0.06em" }}>
                    {n.itemCount} items
                  </div>
                </div>
                <div className="pp-narrative-body">
                  <div className="pp-narrative-label">{n.label}</div>
                  {n.narrativeSummary && <div className="pp-narrative-summary">{n.narrativeSummary}</div>}
                  <div className="pp-narrative-meta-row">
                    {n.sentimentLabel && (
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: sentColor }}>
                        {n.sentimentLabel}
                        {n.sentimentScore != null ? ` ${n.sentimentScore > 0 ? "+" : ""}${n.sentimentScore.toFixed(2)}` : ""}
                      </span>
                    )}
                    {n.platformCount != null && (
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-50)" }}>
                        {n.platformCount} platform{n.platformCount !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                </div>
                <div className="pp-narrative-stats">
                  {n.momentum != null && (
                    <div className="pp-narrative-stat">
                      <div className="pp-narrative-stat-val">{n.momentum.toFixed(1)}</div>
                      <div className="pp-narrative-stat-label">Momentum</div>
                      <div className="pp-narrative-momentum">
                        <div className="pp-narrative-momentum-fill" style={{ width: `${pct}%`, background: color }} />
                      </div>
                    </div>
                  )}
                  {n.velocity24h != null && (
                    <div className="pp-narrative-stat">
                      <div className="pp-narrative-stat-val">{n.velocity24h.toFixed(1)}</div>
                      <div className="pp-narrative-stat-label">Vel/24h</div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ─── Section: Signal briefs (last 24h) ───────────────────────────────────────

function SignalBriefsSection({ companyId }: { companyId: string }) {
  const [briefs, setBriefs] = useState<SignalBrief[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/public/signal-briefs?companyId=${companyId}`)
      .then((r) => r.json())
      .then((d) => { setBriefs(d.briefs ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [companyId]);

  return (
    <section className="pp-section">
      <div className="pp-shead">
        <div className="pp-shead-l">
          <span className="pp-shead-num">03</span>
          <span className="pp-shead-title">Signal briefs</span>
          <span className="pp-shead-desc">high-signal items from the last 24 hours</span>
        </div>
        {briefs.length > 0 && <span className="pp-shead-meta">{briefs.length} items</span>}
      </div>

      {loading ? (
        <div className="pp-empty"><div className="pp-empty-mark">◆</div><div className="pp-empty-title">Loading…</div></div>
      ) : briefs.length === 0 ? (
        <div className="pp-briefs"><div className="pp-brief-empty">∅ No high-signal items in the last 24 hours</div></div>
      ) : (
        <div className="pp-briefs">
          {briefs.map((b) => (
            <div key={b.id} className="pp-brief-row">
              <PlatformChip platform={b.platform} size="sm" />
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-50)" }}>{relTime(b.publishedAt)}</div>
              <div className="pp-brief-title">
                {b.url ? <a href={b.url} target="_blank" rel="noopener noreferrer">{b.title}</a> : b.title}
              </div>
              <div className="pp-brief-cluster">{b.clusterLabel ?? "—"}</div>
              <div className="pp-brief-time">{b.narrativeStage ? <StagePill stage={b.narrativeStage} /> : null}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Section: Signal brief reports ───────────────────────────────────────────

function SignalReportsSection({ companyId }: { companyId: string }) {
  const [reports, setReports] = useState<PublicReport[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/public/reports?companyId=${companyId}`)
      .then((r) => r.json())
      .then((d) => { setReports(d.reports ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [companyId]);

  return (
    <section className="pp-section">
      <div className="pp-shead">
        <div className="pp-shead-l">
          <span className="pp-shead-num">04</span>
          <span className="pp-shead-title">Signal brief reports</span>
          <span className="pp-shead-desc">analyst-generated cluster reports</span>
        </div>
        {reports.length > 0 && <span className="pp-shead-meta">{reports.length} report{reports.length !== 1 ? "s" : ""}</span>}
      </div>

      {loading ? (
        <div className="pp-empty"><div className="pp-empty-mark">◆</div><div className="pp-empty-title">Loading…</div></div>
      ) : reports.length === 0 ? (
        <div className="pp-briefs"><div className="pp-brief-empty">∅ No reports generated yet</div></div>
      ) : (
        <div className="pp-briefs">
          {reports.map((r) => (
            <a
              key={r.id}
              href={`/analyst/report/${r.id}`}
              className="pp-brief-row"
              style={{ textDecoration: "none", color: "inherit" }}
            >
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-50)" }}>{relTime(r.generatedAt)}</div>
              <div className="pp-brief-title">{r.clusterLabel}</div>
              <div className="pp-brief-cluster" style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-40)", letterSpacing: "0.04em" }}>
                View report →
              </div>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Section: News timeline ───────────────────────────────────────────────────

function NewsTimelineSection({ companyId }: { companyId: string }) {
  const [ntlData, setNtlData] = useState<NtlTimelineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [pop, setPop] = useState<HoverPopState>(null);
  const [selected, setSelected] = useState<SelectedDayState>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/news-timeline?companyId=${companyId}&window=7d`)
      .then((r) => r.json())
      .then((d) => { setNtlData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [companyId]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
  }, [ntlData]);

  const onHover = useCallback((day: NtlDay, label: string, e: React.MouseEvent) => {
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setPop({ day, feedLabel: label, x: rect.left + rect.width / 2, y: rect.top, below: rect.top < 200 });
  }, []);
  const onLeave = useCallback(() => setPop(null), []);
  const onDayClick = useCallback((feed: NtlFeed, day: NtlDay) => {
    setPop(null);
    setSelected((prev) => prev?.day.date === day.date && prev.feed.feedId === feed.feedId ? null : { feed, day });
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setSelected(null); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const feeds = ntlData?.feeds ?? [];

  return (
    <section className="pp-section">
      <div className="pp-shead">
        <div className="pp-shead-l">
          <span className="pp-shead-num">05</span>
          <span className="pp-shead-title">News timeline</span>
          <span className="pp-shead-desc">Google Alerts sentiment per feed · last 7 days</span>
        </div>
        {feeds.length > 0 && <span className="pp-shead-meta">{feeds.length} feed{feeds.length !== 1 ? "s" : ""} · avg sentiment per day</span>}
      </div>

      {loading ? (
        <div className="pp-empty"><div className="pp-empty-mark">◈</div><div className="pp-empty-title">Loading…</div></div>
      ) : feeds.length === 0 ? (
        <div className="pp-empty"><div className="pp-empty-mark">∅</div><div className="pp-empty-title">No Google Alerts feeds configured</div></div>
      ) : (
        <>
          <div className="ntl-legend" style={{ marginBottom: 4 }}>
            {(["positive","negative","mixed","neutral"] as const).map((s) => (
              <span key={s} className="ntl-legend-item">
                <span className="ntl-legend-dot" style={{ background: `var(--nd-${s})` }} /> {s.charAt(0).toUpperCase() + s.slice(1)}
              </span>
            ))}
            <span className="ntl-legend-note">one track per Google Alerts feed · dot size = items that day · hover to read, click to expand</span>
          </div>
          <NewsTimeline
            feeds={feeds} win="7d" feedFilter="all"
            style="trend" arrangement="stacked" density="recent" showAvg={true}
            pop={pop} scrollRef={scrollRef}
            onHover={onHover} onLeave={onLeave} onDayClick={onDayClick}
            selectedDay={selected ? { feedId: selected.feed.feedId, date: selected.day.date } : null}
          />
        </>
      )}
      <DayDetailDrawer selected={selected} onClose={() => setSelected(null)} />
    </section>
  );
}

// ─── Portal sidebar ───────────────────────────────────────────────────────────

function PortalSidebar({ companies, activeId, onSelect }: {
  companies: Company[]; activeId: string; onSelect: (id: string) => void;
}) {
  return (
    <aside className="sidebar">
      <div className="pp-brand">
        <div className="pp-brand-mark">GT</div>
        <div>
          <div className="pp-brand-name">Gito</div>
          <div className="pp-brand-sub">Public intelligence</div>
        </div>
      </div>
      <div className="pp-rail-label">
        <span>Tracking</span>
        <span className="pp-rail-label-count">{companies.length} {companies.length === 1 ? "company" : "companies"}</span>
      </div>
      <div className="pp-co-list">
        {companies.map((c) => (
          <button key={c.id} className={cx("pp-co", c.id === activeId && "pp-co-on")} onClick={() => onSelect(c.id)}>
            <span className="pp-co-avatar">{initials(c.name)}</span>
            <span className="pp-co-body">
              <span className="pp-co-name">{c.name}</span>
              <span className="pp-co-sub">Since {new Date(c.createdAt).getFullYear()}</span>
            </span>
            <span className="pp-co-sig">
              <span className="pp-co-sig-dot" />
            </span>
          </button>
        ))}
      </div>
      <div className="pp-foot">
        <div className="pp-foot-row"><Dot color="var(--ok)" pulse /><span>Cron healthy · hourly</span></div>
        <div className="pp-foot-row"><span>usegito.com · read-only</span></div>
      </div>
    </aside>
  );
}

// ─── Inner portal (needs searchParams) ───────────────────────────────────────

function PortalInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);

  const today = todayPacific();
  const dateRange = useMemo(() => Array.from({ length: 7 }, (_, i) => shiftDate(today, -(6 - i))), [today]);
  const [date, setDate] = useState(today);

  useEffect(() => {
    fetch("/api/companies")
      .then((r) => r.json())
      .then((d) => { setCompanies(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const paramCompany = searchParams.get("company");
  const activeId = (paramCompany && companies.find((c) => c.id === paramCompany)) ? paramCompany : companies[0]?.id ?? "";

  function selectCompany(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("company", id);
    router.replace(`?${params.toString()}`, { scroll: false });
    setDate(today);
  }

  const activeCompany = companies.find((c) => c.id === activeId);

  if (loading) {
    return (
      <div className="shell">
        <aside className="sidebar">
          <div className="pp-brand">
            <div className="pp-brand-mark">GT</div>
            <div><div className="pp-brand-name">Gito</div><div className="pp-brand-sub">Public intelligence</div></div>
          </div>
        </aside>
        <main className="pp-main">
          <div className="pp-empty" style={{ marginTop: 80 }}>
            <div className="pp-empty-mark">◐</div>
            <div className="pp-empty-title">Loading…</div>
          </div>
        </main>
      </div>
    );
  }

  if (!activeId) {
    return (
      <div className="shell">
        <aside className="sidebar">
          <div className="pp-brand">
            <div className="pp-brand-mark">GT</div>
            <div><div className="pp-brand-name">Gito</div><div className="pp-brand-sub">Public intelligence</div></div>
          </div>
        </aside>
        <main className="pp-main">
          <div className="pp-empty" style={{ marginTop: 80 }}>
            <div className="pp-empty-mark">∅</div>
            <div className="pp-empty-title">No companies configured</div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="shell">
      <PortalSidebar companies={companies} activeId={activeId} onSelect={selectCompany} />
      <main className="pp-main">
        {/* Sticky header */}
        <header className="pp-topbar">
          <div>
            <div className="pp-tb-eyebrow">
              <span>Intelligence brief</span>
              <span className="pp-live"><Dot color="var(--ok)" size={6} pulse /> live</span>
            </div>
            <h1 className="pp-tb-title">{activeCompany?.name ?? "—"}</h1>
            <div className="pp-tb-meta">
              Since {activeCompany ? new Date(activeCompany.createdAt).getFullYear() : "—"} · read-only public view
            </div>
          </div>
        </header>

        {/* Sections */}
        <DailyBriefSection companyId={activeId} date={date} onDateChange={setDate} dateRange={dateRange} />
        <NarrativesSection companyId={activeId} />
        <SignalBriefsSection companyId={activeId} />
        <SignalReportsSection companyId={activeId} />
        <NewsTimelineSection companyId={activeId} />

        <footer className="pp-page-foot">
          <span>Gito · public intelligence · usegito.com</span>
          <span>Read-only · no clustering or signal/noise marking is editable here</span>
        </footer>
      </main>
    </div>
  );
}

// ─── Client export (rendered by the server page wrapper) ─────────────────────

export function PublicPortalClient() {
  return (
    <Suspense fallback={
      <div className="shell">
        <aside className="sidebar">
          <div className="pp-brand">
            <div className="pp-brand-mark">GT</div>
            <div><div className="pp-brand-name">Gito</div></div>
          </div>
        </aside>
        <main className="pp-main" />
      </div>
    }>
      <PortalInner />
    </Suspense>
  );
}
