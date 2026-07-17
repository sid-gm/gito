"use client";

import { useEffect, useState } from "react";
import { useAnalyst } from "@/components/analyst/AnalystContext";
import {
  sentColor,
  fmtScore,
  fmtDay,
  platformMeta,
  lastNDates,
  todayPacific,
} from "@/components/analyst/data";

const DAYS = 14;

interface ApiPlatform {
  platform: string;
  series: Array<{ date: string; avgSentiment: string | null; count: number }>;
  split: Record<string, number>;
}

interface ChartData {
  key: string;
  label: string;
  color: string;
  values: (number | null)[]; // aligned to the shared date axis
  counts: number[];
  split: Record<string, number>;
}

// Chart geometry (viewBox 0 0 900 216)
const X0 = 48;
const X1 = 884;
const Y0 = 18;
const Y1 = 190;
const MID = (Y0 + Y1) / 2;
const AMP = (Y1 - Y0) / 2;
const N = DAYS;
const STEP = (X1 - X0) / (N - 1);
const Y_TICKS = [1, 0.5, 0, -0.5, -1];
const X_TICK_IDX = [0, 2, 4, 6, 8, 10, 12, 13];

const px = (i: number) => X0 + (X1 - X0) * (i / (N - 1));
const py = (s: number) => MID - s * AMP;

function SentimentChart({
  chart,
  dates,
  hoverIdx,
  onHover,
}: {
  chart: ChartData;
  dates: string[];
  hoverIdx: number | null;
  onHover: (idx: number | null) => void;
}) {
  const { key, label, color, values } = chart;
  const points = values
    .map((s, i) => (s == null ? null : { i, s }))
    .filter((p): p is { i: number; s: number } => p !== null);

  const line = points.map((p) => `${px(p.i).toFixed(1)},${py(p.s).toFixed(1)}`).join(" ");
  const area =
    points.length >= 2
      ? `M ${px(points[0].i).toFixed(1)} ${MID.toFixed(1)} L ` +
        points.map((p) => `${px(p.i).toFixed(1)} ${py(p.s).toFixed(1)}`).join(" L ") +
        ` L ${px(points[points.length - 1].i).toFixed(1)} ${MID.toFixed(1)} Z`
      : null;
  const latest = points.length > 0 ? points[points.length - 1].s : null;

  const hoverVal = hoverIdx != null ? values[hoverIdx] : null;
  let tip: { x: number; y: number; tipX: number; tipY: number } | null = null;
  if (hoverIdx != null && hoverVal != null) {
    const x = px(hoverIdx);
    const y = py(hoverVal);
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
        {latest != null ? (
          <span className="an-chart-latest" style={{ color: sentColor(latest) }}>
            latest {fmtScore(latest)}
          </span>
        ) : (
          <span className="an-chart-latest" style={{ color: "#5f6a80" }}>
            no scored items
          </span>
        )}
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
        {area && <path d={area} fill={`url(#an-cg-${key})`} />}
        {points.length >= 2 && (
          <polyline
            points={line}
            fill="none"
            stroke={color}
            strokeWidth="2.4"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
        {points.map((p) => (
          <circle
            key={p.i}
            cx={px(p.i)}
            cy={py(p.s)}
            r="2.6"
            fill={color}
            stroke="#12151d"
            strokeWidth="1"
          />
        ))}
        {X_TICK_IDX.map((i) => (
          <foreignObject key={i} x={px(i) - 32} y={Y1 + 6} width={64} height={16}>
            <div className="an-xtick-label">{fmtDay(dates[i])}</div>
          </foreignObject>
        ))}
        {tip && hoverIdx != null && hoverVal != null && (
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
                <span className="an-chart-tip-date">{fmtDay(dates[hoverIdx])}</span>
                <span style={{ color: sentColor(hoverVal), fontWeight: 600 }}>
                  {fmtScore(hoverVal)}
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
  const { companyId } = useAnalyst();
  const [hover, setHover] = useState<{ key: string; idx: number } | null>(null);
  const [charts, setCharts] = useState<ChartData[]>([]);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const dates = lastNDates(DAYS, todayPacific());

  const loading = companyId != null && loadedKey !== companyId;

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    fetch(`/api/analyst/sentiment?companyId=${companyId}&days=${DAYS}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: { platforms: ApiPlatform[] }) => {
        if (cancelled) return;
        const axis = lastNDates(DAYS, todayPacific());
        setCharts(
          (data.platforms ?? []).map((p) => {
            const byDate = new Map(p.series.map((d) => [d.date, d]));
            return {
              key: p.platform,
              label: platformMeta(p.platform).label,
              color: platformMeta(p.platform).color,
              values: axis.map((d) => {
                const row = byDate.get(d);
                return row?.avgSentiment != null ? Number(row.avgSentiment) : null;
              }),
              counts: axis.map((d) => byDate.get(d)?.count ?? 0),
              split: p.split,
            };
          })
        );
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadedKey(companyId);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <section className="an-section">
        <div className="an-section-head">
          <h3 className="an-section-title">Sentiment over time</h3>
          <span className="an-section-hint">
            Mean daily score · {DAYS} days · hover for values
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {charts.map((c) => (
            <SentimentChart
              key={c.key}
              chart={c}
              dates={dates}
              hoverIdx={hover?.key === c.key ? hover.idx : null}
              onHover={(idx) =>
                setHover(idx == null ? null : { key: c.key, idx })
              }
            />
          ))}
          {!loading && charts.length === 0 && (
            <div className="an-empty">
              No scored items yet — sentiment runs daily once items land.
            </div>
          )}
        </div>
      </section>

      <section className="an-section">
        <div className="an-section-head" style={{ marginBottom: 4 }}>
          <h3 className="an-section-title">Sentiment by platform</h3>
          <span className="an-section-hint">Share of scored items</span>
        </div>
        <div className="an-section-hint" style={{ marginBottom: 18 }}>
          Positive · neutral · negative split
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {charts.map((c) => {
            const pos = c.split.positive ?? 0;
            const neu = (c.split.neutral ?? 0) + (c.split.mixed ?? 0);
            const neg = c.split.negative ?? 0;
            const total = pos + neu + neg;
            if (total === 0) return null;
            const score = (pos - neg) / total;
            return (
              <div key={c.key}>
                <div className="an-split-row-head">
                  <div className="an-chart-id">
                    <span
                      className="an-chart-swatch"
                      style={{ background: c.color }}
                    />
                    <span style={{ fontSize: 13, fontWeight: 500 }}>
                      {c.label}
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
                  <div style={{ width: `${(pos / total) * 100}%`, background: "#34d399" }} />
                  <div style={{ width: `${(neu / total) * 100}%`, background: "#4b5568" }} />
                  <div style={{ width: `${(neg / total) * 100}%`, background: "#fb7185" }} />
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
