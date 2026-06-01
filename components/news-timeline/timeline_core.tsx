"use client";

import React from "react";
import { cx } from "@/components/primitives";

// ── Types ──────────────────────────────────────────────────────────────────
export type NtlDay = {
  date: string;
  aiSummary: string | null;
  sentimentScore: number | null;
  sentimentLabel: string | null;
  itemCount: number;
};

export type NtlFeed = {
  feedId: string;
  feedLabel: string;
  entityId: string;
  entityLabel: string;
  entityType: string;
  days: NtlDay[];
  _wdays?: NtlDay[];
  _stats?: ReturnType<typeof feedStats>;
  _showAvg?: boolean;
};

export type NtlTimelineData = { feeds: NtlFeed[] };
export type WindowKey = "7d" | "30d" | "90d";
export type StyleKey = "trend" | "rail" | "vertical";
export type ArrangementKey = "stacked" | "combined" | "tabs";
export type DensityKey = "recent" | "all" | "minimal";

export type HoverPopState = {
  day: NtlDay;
  feedLabel: string;
  x: number;
  y: number;
  below: boolean;
} | null;

// ── Layout constants ───────────────────────────────────────────────────────
export const NTL_WINDOWS: Record<WindowKey, number> = { "7d": 7, "30d": 30, "90d": 90 };
export const NTL_COLW: Record<WindowKey, number> = { "7d": 152, "30d": 96, "90d": 30 };
export const NTL_BAND_H = 132;
export const NTL_CHIP_LANE = 104;

// Feed-identity color palette for combined-overlay mode.
const NTL_PALETTE = [
  "oklch(0.55 0.15 280)",
  "oklch(0.58 0.12 190)",
  "oklch(0.60 0.13 40)",
  "oklch(0.56 0.14 150)",
  "oklch(0.62 0.12 320)",
];
export function getFeedColor(index: number): string {
  return NTL_PALETTE[index % NTL_PALETTE.length];
}

export function expandedCount(win: WindowKey, density: DensityKey): number {
  if (density === "minimal") return 0;
  if (density === "all") return win === "90d" ? 0 : NTL_WINDOWS[win];
  return ({ "7d": 7, "30d": 8, "90d": 0 } as Record<WindowKey, number>)[win];
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export function ntlParseDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m: m - 1, d };
}
export function fmtDayMon(iso: string) {
  const p = ntlParseDate(iso);
  return { day: String(p.d), mon: MONTHS[p.m] };
}
export function fmtFullDate(iso: string) {
  const p = ntlParseDate(iso);
  return `${MONTHS[p.m]} ${p.d}, ${p.y}`;
}
export function fmtScore(s: number | null): string {
  if (s == null) return "—";
  const r = (Math.round(s * 100) / 100).toFixed(2);
  return s > 0 ? `+${r}` : r.replace("-", "−");
}
export function sentSlug(label: string | null): string {
  return label && ["positive","negative","mixed","neutral"].includes(label) ? label : "neutral";
}

export function windowSlice(feed: NtlFeed, win: WindowKey): NtlDay[] {
  const n = NTL_WINDOWS[win];
  return feed.days.slice(-n);
}

export function feedStats(days: NtlDay[]) {
  const present = days.filter((d) => d.sentimentScore != null);
  const totalItems = days.reduce((a, d) => a + (d.itemCount || 0), 0);
  if (!present.length) return { avg: null, label: "none", trend: 0, totalItems, activeDays: 0 };
  const avg = present.reduce((a, d) => a + d.sentimentScore!, 0) / present.length;
  const half = Math.floor(present.length / 2);
  const firstAvg = present.slice(0, half).reduce((a, d) => a + d.sentimentScore!, 0) / Math.max(1, half);
  const lastAvg = present.slice(half).reduce((a, d) => a + d.sentimentScore!, 0) / Math.max(1, present.length - half);
  const trend = lastAvg - firstAvg;
  let label = "neutral";
  if (avg >= 0.2) label = "positive"; else if (avg <= -0.2) label = "negative";
  return { avg, label, trend, totalItems, activeDays: present.length };
}

export function scoreToY(score: number): number {
  const v = Math.max(-1, Math.min(1, score));
  return (50 - v * 42) / 100 * NTL_BAND_H;
}
export function dotRadius(itemCount: number): number {
  return 3 + Math.min(itemCount || 0, 10) * 0.42;
}

// ── Sentiment pill ─────────────────────────────────────────────────────────
export function SentPill({ label }: { label: string | null }) {
  const slug = label == null ? "none" : sentSlug(label);
  const txt = label == null ? "no data" : slug;
  return <span className={`sentpill sentpill-${slug}`}>{txt}</span>;
}

// ── Date axis row ──────────────────────────────────────────────────────────
export function TimelineAxis({ days, colW, win }: { days: NtlDay[]; colW: number; win: WindowKey }) {
  const N = days.length;
  const everyN = win === "90d" ? 10 : win === "30d" ? 3 : 1;
  return (
    <div className="ntl-row ntl-axis">
      <div className="ntl-fhead">
        <span className="ntl-axis-title">Date →</span>
      </div>
      <div className="ntl-rail">
        <div className="ntl-axis-track" style={{ width: N * colW }}>
          {days.map((d, i) => {
            if (i % everyN !== 0 && i !== N - 1) return null;
            const dm = fmtDayMon(d.date);
            const isToday = i === N - 1;
            const showMon = i === 0 || dm.day === "1" || (everyN > 1 && i % (everyN * 2) === 0);
            return (
              <div key={d.date} className={cx("ntl-tick", isToday && "ntl-tick-today")} style={{ left: (i + 0.5) * colW }}>
                <span className="ntl-tick-day">{isToday ? "Today" : dm.day}</span>
                {showMon && !isToday && <span className="ntl-tick-mon">{dm.mon}</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Grid lines ─────────────────────────────────────────────────────────────
export function GridLines({ N, colW, win }: { N: number; colW: number; win: WindowKey }) {
  const everyN = win === "90d" ? 10 : win === "30d" ? 3 : 1;
  const lines = [];
  for (let i = 0; i < N; i++) {
    if (i % everyN !== 0) continue;
    lines.push(
      <div key={i} className={cx("ntl-grid-line", win === "7d" && "ntl-grid-line-week")}
           style={{ left: (i + 0.5) * colW }} />
    );
  }
  return <>{lines}</>;
}

// ── Hover popover ──────────────────────────────────────────────────────────
export function HoverPop({ pop }: { pop: HoverPopState }) {
  if (!pop) return null;
  const { day, feedLabel, x, y, below } = pop;
  const slug = day.sentimentScore == null ? "none" : sentSlug(day.sentimentLabel);
  const style: React.CSSProperties = below
    ? { left: x, top: y + 16 }
    : { left: x, top: y - 16, transform: "translate(-50%, -100%)" };
  return (
    <div className="ntl-pop" style={style}>
      <div className="ntl-pop-head">
        <span className="ntl-pop-date">{fmtFullDate(day.date)}</span>
        <span className="ntl-tick-mon" style={{ color: "var(--ink-40)" }}>{feedLabel}</span>
      </div>
      <div className="ntl-pop-row">
        <SentPill label={day.sentimentLabel} />
        {day.sentimentScore != null && (
          <span className={cx("ntl-pop-score", `nd-text-${slug}`)}>{fmtScore(day.sentimentScore)}</span>
        )}
        <span className="ntl-pop-items">{day.itemCount || 0} {day.itemCount === 1 ? "item" : "items"}</span>
      </div>
      {day.aiSummary
        ? <div className="ntl-pop-text">{day.aiSummary}</div>
        : <div className="ntl-pop-empty">No Google Alerts items ingested this day.</div>}
    </div>
  );
}
