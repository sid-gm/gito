"use client";

import { useState } from "react";

export const STAGE_STYLES: Record<string, { label: string; bg: string; color: string }> = {
  relaxed:    { label: "RELAXED",    bg: "#2563EB",                                               color: "#FFFFFF" },
  emerging:   { label: "EMERGING",   bg: "color-mix(in oklch, var(--ok) 15%, transparent)",       color: "var(--ok)" },
  developing: { label: "DEVELOPING", bg: "color-mix(in oklch, var(--accent) 15%, transparent)",   color: "var(--accent)" },
  revival:    { label: "REVIVAL",    bg: "color-mix(in oklch, #8B5CF6 15%, transparent)",         color: "#8B5CF6" },
  peaked:     { label: "PEAKED",     bg: "color-mix(in oklch, var(--warn) 15%, transparent)",     color: "var(--warn)" },
  declining:  { label: "DECLINING",  bg: "color-mix(in oklch, var(--err) 12%, transparent)",      color: "var(--err)" },
};

const STAGE_CONDITIONS: Array<{
  stage: string;
  color: string;
  conditions: Array<{ label: string; check: (v: number, p: number, a: number, age: number) => boolean }>;
}> = [
  { stage: "relaxed",    color: "#2563EB",       conditions: [{ label: "age < 2d",     check: (_v,_p,_a,age) => age < 2 }] },
  { stage: "emerging",   color: "var(--ok)",     conditions: [{ label: "age < 2d",     check: (_v,_p,_a,age) => age < 2 }, { label: "spread or surge", check: (v,_p,a) => v >= 3 || a > 0 }] },
  { stage: "developing", color: "var(--accent)", conditions: [{ label: "v ≥ 3",        check: (v) => v >= 3 }] },
  { stage: "revival",    color: "#8B5CF6",       conditions: [{ label: "v > peak×1.5", check: (v,p) => p > 0 && v > p * 1.5 }, { label: "accel > 0", check: (_v,_p,a) => a > 0 }] },
  { stage: "peaked",     color: "var(--warn)",   conditions: [{ label: "peak ≥ 5",     check: (_v,p) => p >= 5 }, { label: "ratio ≥ 70%", check: (v,p) => p > 0 && v/p >= 0.70 }, { label: "decel", check: (_v,_p,a) => a <= 0 }] },
  { stage: "declining",  color: "var(--err)",    conditions: [{ label: "v = 0 or ratio < 35%", check: (v,p) => v === 0 || (p > 0 && v/p < 0.35) }] },
];

export function StagePill({ stage, velocity24h, prevVelocity24h, peakMomentum, firstSeenAt, platformCount }: {
  stage: string;
  velocity24h?: number | null;
  prevVelocity24h?: number | null;
  peakMomentum?: number | null;
  firstSeenAt?: string | null;
  platformCount?: number | null;
}) {
  const [hovered, setHovered] = useState(false);
  const s = STAGE_STYLES[stage];
  if (!s) return null;

  const v = velocity24h ?? 0;
  const pv = prevVelocity24h ?? 0;
  const pk = peakMomentum ?? 0;
  const accel = v - pv;
  const ageInDays = firstSeenAt ? (Date.now() - new Date(firstSeenAt).getTime()) / 86400000 : 99;
  const ratio = pk > 0 ? v / pk : null;
  const fmt = (n: number | null | undefined) => n == null ? "—" : n.toFixed(1);

  return (
    <span
      style={{ position: "relative", display: "inline-block" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: s.color, background: s.bg, borderRadius: 3, padding: "2px 6px", cursor: "default" }}>
        {s.label}
      </span>
      {hovered && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 9000,
          background: "var(--ink)", color: "var(--paper)", borderRadius: 6,
          padding: "10px 14px", fontSize: 11, fontFamily: "var(--font-mono)",
          whiteSpace: "nowrap", pointerEvents: "none",
          boxShadow: "0 6px 20px rgba(0,0,0,0.25)", minWidth: 260,
        }}>
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "3px 16px", marginBottom: 10 }}>
            <span style={{ opacity: 0.45 }}>velocity</span><span>{fmt(velocity24h)}<span style={{ opacity: 0.5 }}>/day</span></span>
            <span style={{ opacity: 0.45 }}>prev</span><span>{fmt(prevVelocity24h)}<span style={{ opacity: 0.5 }}>/day</span></span>
            <span style={{ opacity: 0.45 }}>accel</span><span>{accel >= 0 ? "+" : ""}{fmt(accel)}<span style={{ opacity: 0.5 }}>/day</span></span>
            <span style={{ opacity: 0.45 }}>peak</span><span>{fmt(peakMomentum)}<span style={{ opacity: 0.5 }}>/day</span></span>
            <span style={{ opacity: 0.45 }}>ratio</span><span>{ratio != null ? `${Math.round(ratio * 100)}%` : "—"}</span>
            <span style={{ opacity: 0.45 }}>platforms</span><span>{platformCount ?? "—"}</span>
          </div>
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.12)", paddingTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
            {STAGE_CONDITIONS.map(({ stage: rs, color, conditions }) => {
              const isActive = rs === stage;
              return (
                <div key={rs} style={{ display: "flex", alignItems: "center", gap: 8, opacity: isActive ? 1 : 0.35 }}>
                  <span style={{ color, width: 8, fontSize: 8 }}>{isActive ? "●" : "○"}</span>
                  <span style={{ color, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", minWidth: 82 }}>{rs}</span>
                  <span style={{ display: "flex", gap: 8 }}>
                    {conditions.map((c) => {
                      const met = c.check(v, pk, accel, ageInDays);
                      return (
                        <span key={c.label} style={{ color: met ? "var(--ok)" : "rgba(255,255,255,0.4)" }}>
                          {c.label}{isActive ? (met ? " ✓" : " ✗") : ""}
                        </span>
                      );
                    })}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </span>
  );
}

function StagePillNode({ s, dim }: { s: string; dim?: boolean }) {
  const style = STAGE_STYLES[s];
  if (!style) return null;
  return (
    <span style={{
      fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700,
      letterSpacing: "0.1em", textTransform: "uppercase",
      color: dim ? "var(--ink-40)" : style.color,
      border: `1px solid ${dim ? "var(--border)" : style.color}`,
      borderRadius: 4, padding: "2px 7px",
      background: dim ? "transparent" : style.bg,
      whiteSpace: "nowrap",
      opacity: dim ? 0.45 : 1,
    }}>
      {style.label}
    </span>
  );
}

function Gate({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 3px", flexShrink: 0 }}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--ink-30)", whiteSpace: "nowrap", marginBottom: 1, textAlign: "center" }}>
        {label}
      </span>
      <span style={{ color: "var(--ink-30)", fontSize: 11, lineHeight: 1 }}>→</span>
    </div>
  );
}

export function StageKey() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginBottom: 10 }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: 6, fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-40)", textTransform: "uppercase", letterSpacing: "0.08em" }}
      >
        <span>{open ? "▾" : "▸"}</span>
        <span>Stage key</span>
        <span style={{ opacity: 0.5, fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>· stages advance only · ratio = velocity ÷ peak</span>
      </button>

      {open && (
        <div style={{ marginTop: 8, padding: "12px 16px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--paper)", overflowX: "auto" }}>

          {/* Main lifecycle row */}
          <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 12, flexWrap: "nowrap" }}>
            <StagePillNode s="relaxed" />
            <Gate label="age<2d + spread" />
            <StagePillNode s="emerging" />
            <Gate label="v≥3 + spread" />
            <StagePillNode s="developing" />
            <Gate label="ratio≥70% + decel" />
            <StagePillNode s="peaked" />
            <Gate label="v=0 or ratio<35%" />
            <StagePillNode s="declining" />
          </div>

          {/* Revival branch */}
          <div style={{ display: "flex", alignItems: "center", gap: 0, paddingLeft: 12, borderLeft: "2px solid var(--border-soft, var(--border))", marginBottom: 12 }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--ink-30)", marginRight: 4, whiteSpace: "nowrap" }}>↑ from peaked</span>
            <Gate label="v>peak×1.5 + accel>0 + social" />
            <StagePillNode s="revival" />
            <Gate label="ratio≥70% + decel" />
            <StagePillNode s="peaked" dim />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--ink-40)", margin: "0 5px" }}>or</span>
            <Gate label="v drops" />
            <StagePillNode s="declining" dim />
          </div>

          {/* Legend */}
          <div style={{ display: "flex", gap: 16, borderTop: "1px solid var(--border)", paddingTop: 8, flexWrap: "wrap" }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-40)" }}>
              <strong style={{ color: "var(--ink-60)" }}>spread</strong> = 2+ non-news or 3+ total platforms
            </span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-40)" }}>
              <strong style={{ color: "var(--ink-60)" }}>social</strong> = 1+ non-news platform
            </span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-40)" }}>
              <strong style={{ color: "var(--ink-60)" }}>declining</strong> = terminal · no recovery
            </span>
          </div>

        </div>
      )}
    </div>
  );
}
