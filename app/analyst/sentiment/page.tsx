"use client";

import { useState } from "react";
import { sentColor, fmtScore } from "@/components/analyst/data";

// Mock series — becomes mean daily sentiment per platform after the DB redesign.
const SERIES: { key: string; label: string; color: string; values: number[] }[] = [
  { key: "news", label: "News", color: "#4f7cff", values: [0.15, 0.28, 0.22, 0.35, 0.42, 0.3, 0.1, -0.05, -0.18, 0.05, 0.25, 0.4, 0.52, 0.38] },
  { key: "reddit", label: "Reddit", color: "#ff5722", values: [0.1, 0.15, 0.05, 0.2, 0.28, 0.12, -0.1, -0.2, -0.05, 0.1, 0.22, 0.3, 0.35, 0.26] },
  { key: "x", label: "X", color: "#c9ccd1", values: [0.05, 0.1, -0.05, 0.12, 0.2, 0, -0.15, -0.3, -0.18, -0.05, 0.1, 0.15, 0.2, 0.08] },
  { key: "threads", label: "Threads", color: "#a78bfa", values: [0.25, 0.3, 0.28, 0.35, 0.4, 0.32, 0.2, 0.15, 0.25, 0.3, 0.38, 0.42, 0.45, 0.4] },
  { key: "instagram", label: "Instagram", color: "#ec4899", values: [0.35, 0.4, 0.38, 0.45, 0.5, 0.48, 0.4, 0.42, 0.5, 0.52, 0.55, 0.58, 0.6, 0.52] },
  { key: "tiktok", label: "TikTok", color: "#22d3ee", values: [0.2, 0.35, 0.3, 0.45, 0.55, 0.4, 0.25, 0.1, 0.3, 0.45, 0.5, 0.55, 0.48, 0.43] },
];

const DATES = ["Jul 3", "Jul 4", "Jul 5", "Jul 6", "Jul 7", "Jul 8", "Jul 9", "Jul 10", "Jul 11", "Jul 12", "Jul 13", "Jul 14", "Jul 15", "Jul 16"];

// Mock positive / neutral / negative share of posts per platform.
const PLATFORM_SPLIT: [label: string, color: string, pos: number, neu: number, neg: number][] = [
  ["Reddit", "#ff5722", 48, 30, 22],
  ["X", "#c9ccd1", 40, 28, 32],
  ["TikTok", "#22d3ee", 58, 27, 15],
  ["Instagram", "#ec4899", 62, 28, 10],
  ["Threads", "#a78bfa", 55, 30, 15],
  ["News", "#4f7cff", 44, 41, 15],
];

// Chart geometry (viewBox 0 0 900 216)
const X0 = 48;
const X1 = 884;
const Y0 = 18;
const Y1 = 190;
const MID = (Y0 + Y1) / 2;
const AMP = (Y1 - Y0) / 2;
const N = DATES.length;
const STEP = (X1 - X0) / (N - 1);
const Y_TICKS = [1, 0.5, 0, -0.5, -1];
const X_TICK_IDX = [0, 2, 4, 6, 8, 10, 12, 13];

const px = (i: number) => X0 + (X1 - X0) * (i / (N - 1));
const py = (s: number) => MID - s * AMP;

function SentimentChart({
  chart,
  hoverIdx,
  onHover,
}: {
  chart: (typeof SERIES)[number];
  hoverIdx: number | null;
  onHover: (idx: number | null) => void;
}) {
  const { key, label, color, values } = chart;
  const line = values.map((s, i) => `${px(i).toFixed(1)},${py(s).toFixed(1)}`).join(" ");
  const area =
    `M ${X0} ${MID.toFixed(1)} L ` +
    values.map((s, i) => `${px(i).toFixed(1)} ${py(s).toFixed(1)}`).join(" L ") +
    ` L ${X1} ${MID.toFixed(1)} Z`;
  const latest = values[values.length - 1];

  let tip: { x: number; y: number; tipX: number; tipY: number } | null = null;
  if (hoverIdx != null) {
    const x = px(hoverIdx);
    const y = py(values[hoverIdx]);
    const tw = 118;
    let tipX = x - tw / 2;
    if (tipX < X0) tipX = X0;
    if (tipX > X1 - tw) tipX = X1 - tw;
    let tipY = y - 40;
    if (tipY < Y0) tipY = y + 14;
    tip = { x, y, tipX, tipY };
  }

  return (
    <div onMouseLeave={() => onHover(null)}>
      <div className="an-chart-head">
        <div className="an-chart-id">
          <span className="an-chart-swatch" style={{ background: color }} />
          <span className="an-chart-label">{label}</span>
        </div>
        <span className="an-chart-latest" style={{ color: sentColor(latest) }}>
          latest {fmtScore(latest)}
        </span>
      </div>
      <svg viewBox="0 0 900 216" className="an-chart-svg">
        <defs>
          <linearGradient id={`an-cg-${key}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {Y_TICKS.map((v) => (
          <g key={v}>
            <line
              x1={X0}
              y1={py(v)}
              x2={X1}
              y2={py(v)}
              stroke="#1e2534"
              strokeWidth="1"
              strokeDasharray="3 4"
            />
            <foreignObject x={0} y={py(v) - 8} width={42} height={16}>
              <div className="an-axis-label">
                {(v > 0 ? "+" : "") + v.toFixed(1).replace(".0", "")}
              </div>
            </foreignObject>
          </g>
        ))}
        <path d={area} fill={`url(#an-cg-${key})`} />
        <polyline
          points={line}
          fill="none"
          stroke={color}
          strokeWidth="2.4"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {values.map((s, i) => (
          <circle
            key={i}
            cx={px(i)}
            cy={py(s)}
            r="2.6"
            fill={color}
            stroke="#12151d"
            strokeWidth="1"
          />
        ))}
        {X_TICK_IDX.map((i) => (
          <foreignObject key={i} x={px(i) - 32} y={Y1 + 6} width={64} height={16}>
            <div className="an-xtick-label">{DATES[i]}</div>
          </foreignObject>
        ))}
        {tip && hoverIdx != null && (
          <g>
            <line
              x1={tip.x}
              y1={Y0}
              x2={tip.x}
              y2={Y1}
              stroke="#3a445c"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            <line
              x1={X0}
              y1={tip.y}
              x2={tip.x}
              y2={tip.y}
              stroke="#3a445c"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            <circle
              cx={tip.x}
              cy={tip.y}
              r="4.8"
              fill={color}
              stroke="#12151d"
              strokeWidth="2"
            />
            <foreignObject x={tip.tipX} y={tip.tipY} width={118} height={28}>
              <div className="an-chart-tip">
                <span className="an-chart-tip-date">{DATES[hoverIdx]}</span>
                <span
                  style={{
                    color: sentColor(values[hoverIdx]),
                    fontWeight: 600,
                  }}
                >
                  {fmtScore(values[hoverIdx])}
                </span>
              </div>
            </foreignObject>
          </g>
        )}
        {values.map((_, i) => (
          <rect
            key={i}
            x={px(i) - STEP / 2}
            y={Y0}
            width={STEP}
            height={Y1 - Y0}
            fill="transparent"
            style={{ pointerEvents: "all", cursor: "crosshair" }}
            onMouseEnter={() => onHover(i)}
          />
        ))}
      </svg>
    </div>
  );
}

export default function SentimentPage() {
  const [hover, setHover] = useState<{ key: string; idx: number } | null>(null);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <section className="an-section">
        <div className="an-section-head">
          <h3 className="an-section-title">Sentiment over time</h3>
          <span className="an-section-hint">
            Mean daily score · 14 days · hover for values
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {SERIES.map((c) => (
            <SentimentChart
              key={c.key}
              chart={c}
              hoverIdx={hover?.key === c.key ? hover.idx : null}
              onHover={(idx) =>
                setHover(idx == null ? null : { key: c.key, idx })
              }
            />
          ))}
        </div>
      </section>

      <section className="an-section">
        <div className="an-section-head" style={{ marginBottom: 4 }}>
          <h3 className="an-section-title">Sentiment by platform</h3>
          <span className="an-section-hint">Social · share of posts</span>
        </div>
        <div className="an-section-hint" style={{ marginBottom: 18 }}>
          Positive · neutral · negative split
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {PLATFORM_SPLIT.map(([label, color, pos, neu, neg]) => {
            const score = (pos - neg) / 100;
            return (
              <div key={label}>
                <div className="an-split-row-head">
                  <div className="an-chart-id">
                    <span
                      className="an-chart-swatch"
                      style={{ background: color }}
                    />
                    <span style={{ fontSize: 13, fontWeight: 500 }}>
                      {label}
                    </span>
                  </div>
                  <span
                    className="an-chart-latest"
                    style={{ fontSize: 12.5, color: sentColor(score) }}
                  >
                    {fmtScore(score)}
                  </span>
                </div>
                <div className="an-split-bar">
                  <div style={{ width: `${pos}%`, background: "#34d399" }} />
                  <div style={{ width: `${neu}%`, background: "#4b5568" }} />
                  <div style={{ width: `${neg}%`, background: "#fb7185" }} />
                </div>
              </div>
            );
          })}
        </div>
        <div className="an-split-legend">
          <div className="an-legend-item">
            <span className="an-legend-swatch" style={{ background: "#34d399" }} />
            Positive
          </div>
          <div className="an-legend-item">
            <span className="an-legend-swatch" style={{ background: "#4b5568" }} />
            Neutral
          </div>
          <div className="an-legend-item">
            <span className="an-legend-swatch" style={{ background: "#fb7185" }} />
            Negative
          </div>
        </div>
      </section>
    </div>
  );
}
