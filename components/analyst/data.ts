/* ==========================================================================
   Analyst UI — shared types, metadata, and mock data.

   Everything here is a stand-in until the database redesign lands:
   - PlatformMeta.key will map to the platform enum on ingested items
   - TopicMeta will map to tracked entities (topics = tracked_entities)
   - RAW_ITEMS / series / group counts will come from API queries
   ========================================================================== */

export type PlatformKey =
  | "reddit"
  | "x"
  | "threads"
  | "instagram"
  | "tiktok"
  | "news";

export type PlatformMeta = {
  key: PlatformKey;
  label: string;
  tag: string;
  color: string;
};

export const PLATFORMS: PlatformMeta[] = [
  { key: "reddit", label: "Reddit", tag: "r/", color: "#ff5722" },
  { key: "x", label: "X", tag: "X", color: "#c9ccd1" },
  { key: "threads", label: "Threads", tag: "@", color: "#a78bfa" },
  { key: "instagram", label: "Instagram", tag: "IG", color: "#ec4899" },
  { key: "tiktok", label: "TikTok", tag: "TT", color: "#22d3ee" },
  { key: "news", label: "News", tag: "RSS", color: "#4f7cff" },
];

/** Topics map to tracked entities once real data is wired in. */
export type TopicMeta = { key: string; label: string; color: string };

export const TOPICS: TopicMeta[] = [
  { key: "su", label: "Streamer University", color: "#4f7cff" },
  { key: "kc", label: "Kai Cenat", color: "#34d399" },
  { key: "sub", label: "Subathon", color: "#f59e0b" },
  { key: "amp", label: "AMP", color: "#a78bfa" },
  { key: "rivals", label: "Twitch Rivals", color: "#22d3ee" },
  { key: "collab", label: "Collabs", color: "#ec4899" },
];

export type RawItem = {
  platform: PlatformKey;
  author: string;
  text: string;
  topic: string;
  sentiment: number; // -1..1, mirrors ingested_items.sentiment_score
  engagement: string;
  timeAgo: string;
};

export const RAW_ITEMS: RawItem[] = [
  { platform: "reddit", author: "r/Kai_Cenat", text: "The Streamer University lineup leaked and it is actually stacked 🔥", topic: "su", sentiment: 0.82, engagement: "4.2k", timeAgo: "2h" },
  { platform: "x", author: "@clipsdaily", text: "streamer university about to break twitch again lol", topic: "su", sentiment: 0.6, engagement: "1.1k", timeAgo: "3h" },
  { platform: "tiktok", author: "@streamtok", text: "POV: you just got your Streamer University acceptance", topic: "su", sentiment: 0.88, engagement: "82k", timeAgo: "4h" },
  { platform: "news", author: "Dexerto", text: "Kai Cenat confirms Streamer University 2 after record applications", topic: "su", sentiment: 0.7, engagement: "—", timeAgo: "5h" },
  { platform: "reddit", author: "r/LivestreamFail", text: "Subathon day 12 numbers are lower than last year peak", topic: "sub", sentiment: -0.35, engagement: "2.8k", timeAgo: "6h" },
  { platform: "x", author: "@esportsheat", text: "why is everyone pretending streamer university is deep, it is a summer camp", topic: "su", sentiment: -0.55, engagement: "640", timeAgo: "7h" },
  { platform: "threads", author: "@kai.updates", text: "Kai really built a whole institution for streamers, insane growth", topic: "kc", sentiment: 0.75, engagement: "980", timeAgo: "9h" },
  { platform: "instagram", author: "@amp.world", text: "Behind the scenes at Streamer U 📸", topic: "su", sentiment: 0.62, engagement: "12k", timeAgo: "11h" },
  { platform: "tiktok", author: "@dramaalert2", text: "streamer university is lowkey cringe idk", topic: "su", sentiment: -0.6, engagement: "24k", timeAgo: "13h" },
  { platform: "news", author: "Dot Esports", text: "Streamer University faces backlash over guest selection", topic: "su", sentiment: -0.45, engagement: "—", timeAgo: "15h" },
  { platform: "reddit", author: "r/Twitch", text: "AMP collab announcement during the subathon was huge", topic: "amp", sentiment: 0.68, engagement: "1.9k", timeAgo: "18h" },
  { platform: "x", author: "@kaicenathive", text: "Kai Cenat subathon raised money for charity again, respect", topic: "sub", sentiment: 0.72, engagement: "3.4k", timeAgo: "20h" },
  { platform: "tiktok", author: "@clipcentral", text: "Fanum and Kai on Twitch Rivals was unreal", topic: "rivals", sentiment: 0.65, engagement: "56k", timeAgo: "22h" },
  { platform: "threads", author: "@streamscene", text: "not sure Streamer University lives up to the hype tbh", topic: "su", sentiment: -0.3, engagement: "410", timeAgo: "1d" },
  { platform: "instagram", author: "@kaicenat", text: "SU commencement 🎓 thank you to everyone who showed up", topic: "su", sentiment: 0.8, engagement: "220k", timeAgo: "1d" },
  { platform: "news", author: "IGN", text: "Kai Cenat Streamer University draws millions of concurrent viewers", topic: "su", sentiment: 0.55, engagement: "—", timeAgo: "1d" },
  { platform: "x", author: "@twitchmetrics", text: "Kai Cenat peaks #1 on Twitch during Streamer University week", topic: "kc", sentiment: 0.5, engagement: "2.2k", timeAgo: "2d" },
  { platform: "reddit", author: "r/LivestreamFail", text: "Collab lineup for SU is mid ngl", topic: "collab", sentiment: -0.4, engagement: "1.3k", timeAgo: "2d" },
];

export const HEADER_CHIPS: { label: string; on: boolean }[] = [
  { label: "Kai Cenat", on: true },
  { label: "Streamer University", on: true },
  { label: "Subathon", on: false },
];

export const TOTAL_ITEMS = "4,812";
export const LAST_SYNC = "2m ago";

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

export function platformMeta(key: PlatformKey): PlatformMeta {
  return PLATFORMS.find((p) => p.key === key)!;
}

export function topicMeta(key: string): TopicMeta {
  return TOPICS.find((t) => t.key === key)!;
}

export function parseEngagement(e: string): number {
  if (!e || e === "—") return 0;
  const m = e.toLowerCase();
  if (m.endsWith("k")) return parseFloat(m) * 1000;
  if (m.endsWith("m")) return parseFloat(m) * 1_000_000;
  return parseFloat(m) || 0;
}
