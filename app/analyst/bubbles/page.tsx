"use client";

import { useEffect, useMemo, useState } from "react";
import { useAnalyst } from "@/components/analyst/AnalystContext";
import {
  platformMeta,
  bubbleColor,
  sentColor,
  fmtScore,
  fmtCount,
  fmtDay,
  lastNDates,
  todayPacific,
} from "@/components/analyst/data";

type BubbleMode = "topic" | "platform";
type Granularity = "day" | "week";

interface ApiStory {
  id: string;
  platform: string;
  title: string | null;
  body: string | null;
  url: string | null;
  author: string | null;
  sentimentScore: number | null;
  reach: number;
}

interface ApiBubble {
  bucket: string;
  count: number;
  avgSentiment: string | null;
  topStories: ApiStory[];
}

type Placed = {
  key: string;
  label: string;
  count: number;
  sent: number;
  stories: ApiStory[];
  r: number;
  x: number;
  y: number;
};

/** Greedy circle packing: largest first, each next circle hugs the pack near the center. */
function packCircles(
  clusters: { key: string; label: string; count: number; sent: number; stories: ApiStory[] }[]
): Placed[] {
  const max = Math.max(1, ...clusters.map((c) => c.count));
  const circles = clusters
    .map((c) => ({ ...c, r: 34 + 58 * Math.sqrt(c.count / max), x: 0, y: 0 }))
    .sort((a, b) => b.r - a.r);
  const placed: Placed[] = [];
  for (const c of circles) {
    if (placed.length === 0) {
      placed.push(c);
      continue;
    }
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;
    for (const p of placed) {
      const dist = p.r + c.r;
      for (let a = 0; a < 360; a += 5) {
        const rad = (a * Math.PI) / 180;
        const x = p.x + Math.cos(rad) * dist;
        const y = p.y + Math.sin(rad) * dist;
        const overlaps = placed.some(
          (q) => Math.hypot(x - q.x, y - q.y) < q.r + c.r - 0.5
        );
        if (!overlaps) {
          const d = Math.hypot(x, y);
          if (d < bestD) {
            bestD = d;
            best = { x, y };
          }
        }
      }
    }
    if (best) {
      c.x = best.x;
      c.y = best.y;
    }
    placed.push(c);
  }
  return placed;
}

const VW = 880;
const VH = 520;
const AW = 832;
const AH = 472;

const DAY_COUNT = 14;
const WEEK_COUNT = 4;

export default function BubblesPage() {
  const { companyId } = useAnalyst();
  const [mode, setMode] = useState<BubbleMode>("platform");
  const [gran, setGran] = useState<Granularity>("day");
  const [periodIdx, setPeriodIdx] = useState<number | null>(null);
  const [bubbles, setBubbles] = useState<ApiBubble[]>([]);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Periods: 14 single days, or 4 rolling 7-day windows, ending today (Pacific)
  const periods = useMemo(() => {
    const today = todayPacific();
    if (gran === "day") {
      return lastNDates(DAY_COUNT, today).map((d) => ({
        end: d,
        label: fmtDay(d),
        sub: "" as string,
      }));
    }
    const ends = lastNDates(WEEK_COUNT * 7, today).filter((_, i) => (i + 1) % 7 === 0);
    return ends.map((end) => {
      const start = lastNDates(7, end)[0];
      return { end, label: `${fmtDay(start)} – ${fmtDay(end)}`, sub: "" };
    });
  }, [gran]);

  const count = periods.length;
  const pidx = Math.min(Math.max(periodIdx ?? count - 1, 0), count - 1);
  const period = periods[pidx];

  const queryKey = `${companyId}|${mode}|${gran}|${period.end}`;
  const loading = companyId != null && loadedKey !== queryKey;

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    const key = `${companyId}|${mode}|${gran}|${period.end}`;
    fetch(
      `/api/analyst/bubbles?companyId=${companyId}&by=${mode}&gran=${gran}&period=${period.end}`
    )
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: { bubbles: ApiBubble[] }) => {
        if (cancelled) return;
        setBubbles(data.bubbles ?? []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadedKey(key);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, mode, gran, period.end]);

  const clusters = bubbles
    .filter((b) => b.count > 0)
    .map((b) => ({
      key: b.bucket,
      label: mode === "platform" ? platformMeta(b.bucket).label : b.bucket,
      count: b.count,
      sent: b.avgSentiment != null ? Math.max(-1, Math.min(1, Number(b.avgSentiment))) : 0,
      stories: b.topStories ?? [],
    }));

  const placed = packCircles(clusters);
  const minX = Math.min(...placed.map((c) => c.x - c.r));
  const maxX = Math.max(...placed.map((c) => c.x + c.r));
  const minY = Math.min(...placed.map((c) => c.y - c.r));
  const maxY = Math.max(...placed.map((c) => c.y + c.r));
  const bw = maxX - minX || 1;
  const bh = maxY - minY || 1;
  const scale = Math.min(AW / bw, AH / bh);
  const offX = (VW - bw * scale) / 2;
  const offY = (VH - bh * scale) / 2;

  const selected = placed.find((c) => c.key === selectedKey) ?? null;
  const scrubLabel = period.label;
  const scrubSub =
    gran === "day" ? `Day ${pidx + 1} of ${count}` : `Week ${pidx + 1} of ${count}`;

  const segBtn = (on: boolean) => `an-seg-btn${on ? " an-seg-btn-on" : ""}`;

  return (
    <div>
      <div className="an-bubble-toolbar">
        <div className="an-seg">
          <button
            className={segBtn(mode === "topic")}
            onClick={() => {
              setMode("topic");
              setSelectedKey(null);
            }}
          >
            By topic
          </button>
          <button
            className={segBtn(mode === "platform")}
            onClick={() => {
              setMode("platform");
              setSelectedKey(null);
            }}
          >
            By platform
          </button>
        </div>
        <div className="an-seg">
          <button
            className={segBtn(gran === "day")}
            onClick={() => {
              setGran("day");
              setPeriodIdx(null);
              setSelectedKey(null);
            }}
          >
            Day
          </button>
          <button
            className={segBtn(gran === "week")}
            onClick={() => {
              setGran("week");
              setPeriodIdx(null);
              setSelectedKey(null);
            }}
          >
            Week
          </button>
        </div>
        <div className="an-bubble-legend">
          <div className="an-bubble-legend-scale">
            <span>Negative</span>
            <span className="an-bubble-gradient" />
            <span>Positive</span>
          </div>
          <div className="an-bubble-legend-vol">
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#4b5568" }} />
            <span style={{ width: 15, height: 15, borderRadius: "50%", background: "#4b5568" }} />
            <span>volume</span>
          </div>
        </div>
      </div>

      <div className="an-scrubber">
        <button
          className="an-scrub-arrow"
          disabled={pidx === 0}
          onClick={() => setPeriodIdx(Math.max(0, pidx - 1))}
        >
          ◀
        </button>
        <div className="an-scrub-label">
          <div className="an-scrub-title">{scrubLabel}</div>
          <div className="an-scrub-sub">{scrubSub}</div>
        </div>
        <div className="an-scrub-ticks">
          {periods.map((p, i) => (
            <button
              key={p.end}
              aria-label={p.label}
              className={`an-scrub-tick${i === pidx ? " an-scrub-tick-on" : ""}`}
              onClick={() => setPeriodIdx(i)}
            />
          ))}
        </div>
        <button
          className="an-scrub-arrow"
          disabled={pidx === count - 1}
          onClick={() => setPeriodIdx(Math.min(count - 1, pidx + 1))}
        >
          ▶
        </button>
      </div>

      <div className="an-bubble-stage">
        {placed.length > 0 ? (
          <svg viewBox={`0 0 ${VW} ${VH}`} className="an-bubble-svg">
            {placed.map((c) => {
              const cx = (c.x - minX) * scale + offX;
              const cy = (c.y - minY) * scale + offY;
              const r = c.r * scale;
              const col = bubbleColor(c.sent);
              const isSel = selectedKey === c.key;
              return (
                <circle
                  key={c.key}
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill={col.fill}
                  stroke={isSel ? "#e9edf5" : col.stroke}
                  strokeWidth={isSel ? 3.5 : 1.5}
                  style={{ cursor: "pointer" }}
                  onClick={() =>
                    setSelectedKey((k) => (k === c.key ? null : c.key))
                  }
                />
              );
            })}
            {placed.map((c) => {
              const cx = (c.x - minX) * scale + offX;
              const cy = (c.y - minY) * scale + offY;
              const r = c.r * scale;
              const fs = Math.max(10.5, Math.min(19, r * 0.26));
              return (
                <foreignObject
                  key={c.key}
                  x={cx - r}
                  y={cy - r}
                  width={2 * r}
                  height={2 * r}
                >
                  <div
                    className="an-bubble-fo-wrap"
                    style={{ padding: Math.round(r * 0.2) }}
                  >
                    <div
                      style={{
                        fontWeight: 600,
                        fontSize: fs,
                        lineHeight: 1.15,
                        letterSpacing: "-0.01em",
                        color: "#1a1c1a",
                      }}
                    >
                      {c.label}
                    </div>
                    <div
                      className="an-mono"
                      style={{
                        fontSize: fs * 0.72,
                        color: "rgba(20,22,20,0.55)",
                        marginTop: 4,
                      }}
                    >
                      {c.count.toLocaleString()} items
                    </div>
                  </div>
                </foreignObject>
              );
            })}
          </svg>
        ) : (
          <div className="an-empty" style={{ padding: "80px 0" }}>
            {loading ? "Loading…" : "No items in this period."}
          </div>
        )}
      </div>

      {selected && (
        <div className="an-stories">
          <div className="an-stories-head">
            <div style={{ flex: 1 }}>
              <div className="an-stories-title">
                Top stories · {selected.label}
              </div>
              <div className="an-stories-sub">
                {mode === "topic" ? "Topic" : "Platform"} · {scrubLabel}
                {selected.stories.length === 0 ? " · no items in window" : ""}
              </div>
            </div>
            <button
              className="an-stories-close"
              onClick={() => setSelectedKey(null)}
            >
              Close
            </button>
          </div>
          {selected.stories.map((s) => {
            const pm = platformMeta(s.platform);
            const text = [s.title, s.body].filter(Boolean).join(" — ");
            return (
              <div key={s.id} className="an-story-row">
                <div>
                  <span
                    className="an-tag"
                    style={{ background: pm.color + "22", color: pm.color }}
                  >
                    {pm.tag}
                  </span>
                </div>
                <div className="an-cell-source">
                  <div className="an-cell-author">{s.author ?? "—"}</div>
                  <div className="an-cell-meta">{pm.label}</div>
                </div>
                <div className="an-cell-text">
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noreferrer" className="an-cell-link">
                      {text || s.url}
                    </a>
                  ) : (
                    text || "—"
                  )}
                </div>
                <div className="an-cell-sent">
                  {s.sentimentScore != null ? (
                    <>
                      <span
                        className="an-sent-dot"
                        style={{ background: sentColor(s.sentimentScore) }}
                      />
                      <span className="an-cell-sent-score">
                        {fmtScore(s.sentimentScore)}
                      </span>
                    </>
                  ) : (
                    <span className="an-cell-meta">pending</span>
                  )}
                </div>
                <div className="an-cell-eng">{fmtCount(s.reach)}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
