"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type AttentionItem = {
  title: string;
  whatHappened: string;
  publicReaction: string;
  risk: string;
  recommendation: string;
  storylineId: string | null;
  clusterIds: string[];
};

type BriefSnapshot = {
  headline: string;
  attentionItems: AttentionItem[];
  overallSentiment: { line: string; newsScore: number | null; socialScore: number | null };
  sources: { storylineCount: number; clusterCount: number; itemCount: number };
};

type Brief = {
  id: string;
  periodDate: string;
  snapshotData: BriefSnapshot;
  generatedAt: string;
};

function riskColor(risk: string): string {
  const level = risk.trim().toLowerCase();
  if (level.startsWith("high")) return "var(--err)";
  if (level.startsWith("medium")) return "var(--warn)";
  if (level.startsWith("low")) return "var(--ok)";
  return "var(--ink-40)";
}

function fmtScore(v: number | null): string {
  return v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;
}

function sentColor(score: number | null): string {
  if (score == null) return "var(--ink-50)";
  if (score <= -0.3) return "var(--err)";
  if (score >= 0.3) return "var(--ok)";
  return "var(--warn)";
}

const SECTION_LABEL: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 9,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  color: "var(--ink-40)",
  marginBottom: 2,
};

export function DailyBriefPanel({ companyId, dateKey, canRegenerate }: {
  companyId: string;
  dateKey: string;
  canRegenerate: boolean;
}) {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/daily-brief?companyId=${companyId}&date=${dateKey}`);
      if (res.ok) {
        const data = await res.json();
        setBrief(data.brief ?? null);
      } else {
        setBrief(null);
      }
    } catch {
      setBrief(null);
    } finally {
      setLoaded(true);
    }
  }, [companyId, dateKey]);

  useEffect(() => {
    setLoaded(false);
    load();
  }, [load]);

  const regenerate = useCallback(async () => {
    setGenerating(true);
    try {
      await fetch(`/api/run/daily-brief?companyId=${companyId}&date=${dateKey}&force=true`, { method: "POST" });
      await load();
    } finally {
      setGenerating(false);
    }
  }, [companyId, dateKey, load]);

  if (!loaded) return null;

  if (!brief) {
    if (!canRegenerate) return null;
    return (
      <div style={{ border: "1px dashed var(--border)", borderRadius: 8, padding: "14px 18px", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, background: "var(--paper)" }}>
        <span style={{ fontSize: 13, color: "var(--ink-50)" }}>No executive brief generated for this day yet.</span>
        <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={regenerate} disabled={generating}>
          {generating ? "Generating…" : "◉ Generate brief"}
        </button>
      </div>
    );
  }

  const snap = brief.snapshotData;
  const generatedTime = new Date(brief.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 8, background: "var(--paper)", padding: "18px 22px", marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--accent)" }}>
          Executive brief · what needs your attention
        </span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--ink-40)", display: "flex", alignItems: "center", gap: 10 }}>
          {snap.sources.itemCount} items · {snap.sources.clusterCount} clusters · generated {generatedTime}
          {canRegenerate && (
            <button className="btn btn-ghost" style={{ fontSize: 10.5, padding: "1px 8px" }} onClick={regenerate} disabled={generating}>
              {generating ? "…" : "↻"}
            </button>
          )}
        </span>
      </div>

      <h2 style={{ fontSize: 19, fontWeight: 600, lineHeight: 1.35, margin: "0 0 8px", letterSpacing: "-0.01em" }}>
        {snap.headline}
      </h2>

      {(snap.overallSentiment.line || snap.overallSentiment.newsScore != null) && (
        <p style={{ fontSize: 13, color: "var(--ink-60)", lineHeight: 1.5, margin: "0 0 14px" }}>
          {snap.overallSentiment.line}{" "}
          {(snap.overallSentiment.newsScore != null || snap.overallSentiment.socialScore != null) && (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, whiteSpace: "nowrap" }}>
              news <strong style={{ color: sentColor(snap.overallSentiment.newsScore) }}>{fmtScore(snap.overallSentiment.newsScore)}</strong>
              {" · "}
              social <strong style={{ color: sentColor(snap.overallSentiment.socialScore) }}>{fmtScore(snap.overallSentiment.socialScore)}</strong>
            </span>
          )}
        </p>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 10 }}>
        {snap.attentionItems.map((item, i) => (
          <div key={i} style={{ border: "1px solid var(--border-soft)", borderRadius: 6, padding: "12px 14px", background: "color-mix(in oklch, var(--ink) 2%, var(--paper))" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600, color: "var(--ink-30)" }}>{i + 1}</span>
              <span style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.35, flex: 1 }}>
                {item.storylineId ? (
                  <Link href={`/analyst/storylines/${item.storylineId}`} style={{ color: "var(--ink)", textDecoration: "none" }}>
                    {item.title} <span style={{ color: "var(--ink-30)", fontWeight: 400 }}>∿</span>
                  </Link>
                ) : (
                  item.title
                )}
              </span>
              {item.risk && (
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 8.5, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: riskColor(item.risk), border: `1px solid ${riskColor(item.risk)}`, borderRadius: 3, padding: "1px 5px", whiteSpace: "nowrap" }}>
                  {item.risk.split(/[—\-–]/)[0].trim() || "risk"}
                </span>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 7, fontSize: 12.5, lineHeight: 1.5, color: "var(--ink-80)" }}>
              {item.whatHappened && (
                <div><div style={SECTION_LABEL}>What happened</div>{item.whatHappened}</div>
              )}
              {item.publicReaction && (
                <div><div style={SECTION_LABEL}>Public reaction</div>{item.publicReaction}</div>
              )}
              {item.risk && item.risk.includes("—") && (
                <div><div style={SECTION_LABEL}>Risk</div>{item.risk.split("—").slice(1).join("—").trim()}</div>
              )}
              {item.recommendation && (
                <div>
                  <div style={{ ...SECTION_LABEL, color: "var(--accent)" }}>Recommendation</div>
                  {item.recommendation}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
