"use client";

export const cx = (...a: (string | boolean | undefined | null)[]) =>
  a.filter(Boolean).join(" ");

export const PLATFORMS: Record<string, { label: string; short: string; hue: number }> = {
  hackernews:    { label: "HackerNews",    short: "HN", hue: 30  },
  reddit:        { label: "Reddit",        short: "RD", hue: 10  },
  twitter:       { label: "X / Twitter",   short: "XM", hue: 210 },
  google_alerts: { label: "Google Alerts", short: "GA", hue: 230 },
  manual:        { label: "Manual",        short: "MN", hue: 280 },
  threads:       { label: "Threads",       short: "TH", hue: 150 },
};

export function Dot({
  color = "var(--ok)",
  size = 6,
  pulse = false,
}: {
  color?: string;
  size?: number;
  pulse?: boolean;
}) {
  return (
    <span
      className={cx("dot", pulse && "dot-pulse")}
      style={{ width: size, height: size, background: color, display: "inline-block" }}
    />
  );
}

export function Sparkline({
  values,
  color = "var(--ink-60)",
  height = 26,
  fill = false,
}: {
  values: number[];
  color?: string;
  height?: number;
  fill?: boolean;
}) {
  const w = 120;
  const h = height;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => [
    (i / (values.length - 1)) * w,
    h - (v / max) * (h - 2) - 1,
  ]);
  const d = pts
    .map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`)
    .join(" ");
  const area = `${d} L${w},${h} L0,${h} Z`;
  return (
    <svg width={w} height={h} className="spark" aria-hidden>
      {fill && <path d={area} fill={color} opacity="0.12" />}
      <path d={d} fill="none" stroke={color} strokeWidth="1.25" />
    </svg>
  );
}

export function PlatformChip({
  platform,
  size = "sm",
}: {
  platform: string;
  size?: "sm" | "lg";
}) {
  const p = PLATFORMS[platform] ?? { label: platform, short: "?", hue: 0 };
  return (
    <span
      className={cx("pchip", size === "lg" && "pchip-lg")}
      style={{ "--phue": p.hue } as React.CSSProperties}
      title={p.label}
    >
      <span className="pchip-mono">{p.short}</span>
      <span className="pchip-label">{p.label}</span>
    </span>
  );
}

export function SignalTag({ level }: { level: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    high:   { label: "SIGNAL", cls: "tag-signal-hi" },
    medium: { label: "WATCH",  cls: "tag-signal-md" },
    low:    { label: "NOISE",  cls: "tag-signal-lo" },
  };
  const m = map[level] ?? map.low;
  return <span className={cx("tag", m.cls)}>{m.label}</span>;
}

export function SentimentBar({ value }: { value: number }) {
  const v = Math.max(-1, Math.min(1, value));
  const w = Math.abs(v) * 50;
  return (
    <span className="sent">
      <span className="sent-axis" />
      <span
        className={cx("sent-fill", v < 0 ? "sent-neg" : "sent-pos")}
        style={{
          width: `${w}%`,
          ...(v < 0 ? { right: "50%" } : { left: "50%" }),
        }}
      />
    </span>
  );
}

export function EntityBadge({ label, type }: { label: string; type: string }) {
  const glyph = type === "executive" ? "◉" : type === "product" ? "◧" : "◇";
  return (
    <span className={cx("ebadge", `ebadge-${type}`)}>
      <span className={cx("ebadge-glyph", `eg-${type}`)}>{glyph}</span>
      {label}
    </span>
  );
}

export function Field({
  label,
  hint,
  full,
  children,
}: {
  label: string;
  hint?: string;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cx("field", full && "field-full")}>
      <div className="field-label">{label}</div>
      {children}
      {hint && <div className="field-hint">{hint}</div>}
    </div>
  );
}
