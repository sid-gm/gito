"use client";

import { useState } from "react";
import {
  RAW_ITEMS,
  platformMeta,
  bubbleColor,
  sentColor,
  fmtScore,
  parseEngagement,
} from "@/components/analyst/data";

type BubbleMode = "topic" | "platform";
type Granularity = "day" | "week";

const DAY_LABELS = ["Jul 3", "Jul 4", "Jul 5", "Jul 6", "Jul 7", "Jul 8", "Jul 9", "Jul 10", "Jul 11", "Jul 12", "Jul 13", "Jul 14", "Jul 15", "Jul 16"];
const DAY_SHARES = [5, 6, 7, 8, 10, 9, 6, 5, 7, 8, 9, 11, 7, 5];
const WEEK_LABELS = ["Jun 23 – 29", "Jun 30 – Jul 6", "Jul 7 – 13", "Jul 14 – 20"];
const WEEK_SHARES = [18, 24, 33, 25];

// Mock cluster volumes — becomes grouped counts per period after the DB redesign.
const CLUSTER_BASE: Record<BubbleMode, [key: string, label: string, count: number, sent: number][]> = {
  topic: [
    ["su", "Streamer University", 1980, 0.3],
    ["kc", "Kai Cenat", 1240, 0.42],
    ["sub", "Subathon", 610, -0.22],
    ["amp", "AMP", 380, 0.25],
    ["rivals", "Twitch Rivals", 340, 0.18],
    ["collab", "Collabs", 262, -0.15],
  ],
  platform: [
    ["reddit", "Reddit", 1420, 0.26],
    ["x", "X", 1180, 0.08],
    ["tiktok", "TikTok", 960, 0.43],
    ["instagram", "Instagram", 540, 0.52],
    ["threads", "Threads", 410, 0.4],
    ["news", "News", 302, 0.29],
  ],
};

type Placed = {
  key: string;
  label: string;
  count: number;
  sent: number;
  r: number;
  x: number;
  y: number;
};

/** Greedy circle packing: largest first, each next circle hugs the pack near the center. */
function packCircles(
  clusters: { key: string; label: string; count: number; sent: number }[]
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

export default function BubblesPage() {
  const [mode, setMode] = useState<BubbleMode>("platform");
  const [gran, setGran] = useState<Granularity>("day");
  const [periodIdx, setPeriodIdx] = useState<number | null>(null);
  const [selected, setSelected] = useState<{
    type: BubbleMode;
    key: string;
    label: string;
  } | null>(null);

  const labels = gran === "day" ? DAY_LABELS : WEEK_LABELS;
  const shares = gran === "day" ? DAY_SHARES : WEEK_SHARES;
  const shareSum = shares.reduce((a, b) => a + b, 0);
  const count = labels.length;
  const pidx = Math.min(Math.max(periodIdx ?? count - 1, 0), count - 1);
  const share = shares[pidx] / shareSum;

  const clusters = CLUSTER_BASE[mode]
    .map(([key, label, base, sent], i) => {
      // Deterministic per-period jitter so scrubbing feels alive without randomness.
      const jitter = (((i * 7 + pidx * 11) % 9) - 4) / 45;
      return {
        key,
        label,
        count: Math.max(0, Math.round(base * share)),
        sent: Math.max(-1, Math.min(1, sent + jitter)),
      };
    })
    .filter((c) => c.count > 0);

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

  const scrubLabel = `${labels[pidx]}, 2026`;
  const scrubSub =
    gran === "day" ? `Day ${pidx + 1} of ${count}` : `Week ${pidx + 1} of ${count}`;

  const stories = selected
    ? RAW_ITEMS.filter((r) =>
        selected.type === "topic"
          ? r.topic === selected.key
          : r.platform === selected.key
      )
        .sort((a, b) => parseEngagement(b.engagement) - parseEngagement(a.engagement))
        .slice(0, 5)
    : [];

  const segBtn = (on: boolean) => `an-seg-btn${on ? " an-seg-btn-on" : ""}`;

  return (
    <div>
      <div className="an-bubble-toolbar">
        <div className="an-seg">
          <button
            className={segBtn(mode === "topic")}
            onClick={() => {
              setMode("topic");
              setSelected(null);
            }}
          >
            By topic
          </button>
          <button
            className={segBtn(mode === "platform")}
            onClick={() => {
              setMode("platform");
              setSelected(null);
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
              setSelected(null);
            }}
          >
            Day
          </button>
          <button
            className={segBtn(gran === "week")}
            onClick={() => {
              setGran("week");
              setPeriodIdx(null);
              setSelected(null);
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
          {labels.map((l, i) => (
            <button
              key={l}
              aria-label={l}
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
        <svg viewBox={`0 0 ${VW} ${VH}`} className="an-bubble-svg">
          {placed.map((c) => {
            const cx = (c.x - minX) * scale + offX;
            const cy = (c.y - minY) * scale + offY;
            const r = c.r * scale;
            const col = bubbleColor(c.sent);
            const isSel = selected?.key === c.key;
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
                  setSelected((s) =>
                    s?.key === c.key
                      ? null
                      : { type: mode, key: c.key, label: c.label }
                  )
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
      </div>

      {selected && (
        <div className="an-stories">
          <div className="an-stories-head">
            <div style={{ flex: 1 }}>
              <div className="an-stories-title">
                Top stories · {selected.label}
              </div>
              <div className="an-stories-sub">
                {selected.type === "topic" ? "Topic" : "Platform"} · {scrubLabel}
                {stories.length === 0 ? " · no items in window" : ""}
              </div>
            </div>
            <button
              className="an-stories-close"
              onClick={() => setSelected(null)}
            >
              Close
            </button>
          </div>
          {stories.map((s, i) => {
            const pm = platformMeta(s.platform);
            return (
              <div key={i} className="an-story-row">
                <div>
                  <span
                    className="an-tag"
                    style={{ background: pm.color + "22", color: pm.color }}
                  >
                    {pm.tag}
                  </span>
                </div>
                <div className="an-cell-source">
                  <div className="an-cell-author">{s.author}</div>
                  <div className="an-cell-meta">
                    {pm.label} · {s.timeAgo}
                  </div>
                </div>
                <div className="an-cell-text">{s.text}</div>
                <div className="an-cell-sent">
                  <span
                    className="an-sent-dot"
                    style={{ background: sentColor(s.sentiment) }}
                  />
                  <span className="an-cell-sent-score">
                    {fmtScore(s.sentiment)}
                  </span>
                </div>
                <div className="an-cell-eng">{s.engagement}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
