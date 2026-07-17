/* ==========================================================================
   Analyst UI — shared platform metadata, topic colors, and formatters.
   Data comes from /api/analyst/*; this file holds only presentation helpers.
   ========================================================================== */

export type PlatformKey =
  | "twitter"
  | "threads"
  | "reddit"
  | "instagram"
  | "facebook"
  | "linkedin"
  | "news"
  | "manual";

export type PlatformMeta = {
  key: PlatformKey;
  label: string;
  tag: string;
  color: string;
};

export const PLATFORMS: PlatformMeta[] = [
  { key: "reddit", label: "Reddit", tag: "r/", color: "#ff5722" },
  { key: "twitter", label: "X", tag: "X", color: "#c9ccd1" },
  { key: "threads", label: "Threads", tag: "@", color: "#a78bfa" },
  { key: "instagram", label: "Instagram", tag: "IG", color: "#ec4899" },
  { key: "facebook", label: "Facebook", tag: "f", color: "#60a5fa" },
  { key: "linkedin", label: "LinkedIn", tag: "in", color: "#38bdf8" },
  { key: "news", label: "News", tag: "RSS", color: "#4f7cff" },
  { key: "manual", label: "Manual", tag: "✂", color: "#7b8398" },
];

const FALLBACK_PLATFORM: PlatformMeta = { key: "manual", label: "Other", tag: "•", color: "#7b8398" };

export function platformMeta(key: string): PlatformMeta {
  return PLATFORMS.find((p) => p.key === key) ?? FALLBACK_PLATFORM;
}

/* ─── Topic colors — stable per topic id/label ───────────────────────── */

const TOPIC_PALETTE = ["#4f7cff", "#34d399", "#f59e0b", "#a78bfa", "#22d3ee", "#ec4899", "#fb7185", "#facc15"];

export function topicColor(idOrLabel: string | null | undefined): string {
  if (!idOrLabel) return "#7b8398";
  let h = 0;
  for (let i = 0; i < idOrLabel.length; i++) h = (h * 31 + idOrLabel.charCodeAt(i)) >>> 0;
  return TOPIC_PALETTE[h % TOPIC_PALETTE.length];
}

/* ─── Sentiment helpers ──────────────────────────────────────────────── */

function lerp(a: number, b: number, t: number) {
  return Math.round(a + (b - a) * t);
}

/** Slate → green/red interpolation for dots and scores on dark panels. */
export function sentColor(s: number): string {
  const neu = [148, 163, 184];
  const pos = [52, 211, 153];
  const neg = [251, 113, 133];
  const to = s >= 0 ? pos : neg;
  const t = Math.abs(s);
  const c = neu.map((v, i) => lerp(v, to[i], t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** Warm pastel interpolation for bubble fills (readable dark text on top). */
export function bubbleColor(s: number): { fill: string; stroke: string } {
  const neu = [232, 222, 210];
  const pos = [150, 206, 169];
  const neg = [242, 150, 140];
  const to = s >= 0 ? pos : neg;
  const t = Math.abs(s);
  const c = neu.map((v, i) => lerp(v, to[i], t));
  const d = c.map((v) => Math.round(v * 0.86));
  return {
    fill: `rgb(${c[0]},${c[1]},${c[2]})`,
    stroke: `rgb(${d[0]},${d[1]},${d[2]})`,
  };
}

export function fmtScore(s: number): string {
  return (s >= 0 ? "+" : "") + s.toFixed(2);
}

export function sentLabel(s: number): string {
  return s >= 0.15 ? "Positive" : s <= -0.15 ? "Negative" : "Neutral";
}

/* ─── Formatters ─────────────────────────────────────────────────────── */

export function fmtCount(n: number | null | undefined): string {
  if (n == null || n === 0) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  if (isNaN(diff)) return "—";
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  return `${Math.floor(days / 30)}mo`;
}

/** "2026-07-16" → "Jul 16" */
export function fmtDay(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Today's date in the analyst's timezone (Pacific bucketing on the server). */
export function todayPacific(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

/** N consecutive dates (YYYY-MM-DD) ending at `end` inclusive. */
export function lastNDates(n: number, end: string): string[] {
  const out: string[] = [];
  const endDate = new Date(`${end}T12:00:00Z`);
  for (let i = n - 1; i >= 0; i--) {
    out.push(new Date(endDate.getTime() - i * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
}

/* ─── API row types (shared across views) ────────────────────────────── */

export interface AnalystItem {
  id: string;
  platform: PlatformKey;
  kind: "post" | "comment";
  url: string | null;
  author: string | null;
  title: string | null;
  body: string | null;
  publishedAt: string | null;
  createdAt: string;
  topicId: string | null;
  topicLabel: string | null;
  sentimentScore: number | null;
  sentimentLabel: string | null;
  reach: number;
}

export interface Topic {
  id: string;
  label: string;
}

export interface Company {
  id: string;
  name: string;
}
