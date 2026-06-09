"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { PlatformChip } from "@/components/primitives";

type NewsLink = {
  id: string;
  headline: string;
  url: string | null;
  publishedAt: string | null;
  relationship: string;
  explanation: string | null;
};

type MemberCluster = {
  id: string;
  label: string | null;
  itemCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  narrativeStage: string | null;
  narrativeSummary: string | null;
  sentimentScore: number | null;
  sentimentLabel: string | null;
  effectiveClassification: string;
  isOrigin: boolean;
  platforms: Array<{ platform: string; itemCount: number }>;
  newsLinks: NewsLink[];
};

type StorylineDetail = {
  id: string;
  entityId: string;
  entityLabel: string | null;
  title: string;
  summary: string | null;
  status: string;
  firstSeenAt: string;
  lastSeenAt: string;
  newsSentimentScore: number | null;
  socialSentimentScore: number | null;
  platformLens: Record<string, { digest: string; quote: string | null }> | null;
  lensGeneratedAt: string | null;
};

function shortDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fullDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function sentColor(score: number | null): string {
  if (score == null) return "var(--ink-50)";
  if (score <= -0.3) return "var(--err)";
  if (score >= 0.3) return "var(--ok)";
  return "var(--warn)";
}

function cleanTitle(raw: string | null): string | null {
  if (!raw) return null;
  return raw
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .trim() || null;
}

function SentStat({ label, score }: { label: string; score: number | null }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--ink-40)" }}>{label}</span>
      <span style={{ fontSize: 22, fontWeight: 600, lineHeight: 1, color: sentColor(score), fontVariantNumeric: "tabular-nums" }}>
        {score == null ? "—" : `${score >= 0 ? "+" : ""}${score.toFixed(2)}`}
      </span>
    </div>
  );
}

export default function StorylineDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [storyline, setStoryline] = useState<StorylineDetail | null>(null);
  const [members, setMembers] = useState<MemberCluster[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [reportingId, setReportingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/storylines/${id}`);
    if (!res.ok) {
      setError("Storyline not found");
      return;
    }
    const data = await res.json();
    setStoryline(data.storyline);
    setMembers(data.clusters ?? []);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const refreshLens = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetch(`/api/run/assign-storylines?storylineId=${id}`, { method: "POST" });
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [id, load]);

  const generateBrief = useCallback(async (clusterId: string, linkedIds: string[]) => {
    setReportingId(clusterId);
    try {
      const res = await fetch(`/api/clusters/${clusterId}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkedClusterIds: linkedIds }),
      });
      const { reportId } = await res.json();
      router.push(`/analyst/report/${reportId}`);
    } catch {
      setReportingId(null);
    }
  }, [router]);

  if (error) {
    return (
      <div className="page">
        <div className="empty"><div className="empty-mark">∿</div><div className="empty-title">{error}</div></div>
      </div>
    );
  }
  if (!storyline) {
    return (
      <div className="page">
        <div className="empty"><div className="empty-mark">⧖</div><div className="empty-title">Loading storyline…</div></div>
      </div>
    );
  }

  const lensEntries = Object.entries(storyline.platformLens ?? {});

  return (
    <>
      <header className="topbar">
        <div style={{ minWidth: 0 }}>
          <div className="eyebrow">
            <Link href="/analyst/storylines" style={{ color: "inherit", textDecoration: "none" }}>Storylines</Link>
            {" · "}{storyline.entityLabel ?? "—"}
          </div>
          <h1 className="page-title" style={{ lineHeight: 1.25 }}>{storyline.title}</h1>
          <p className="page-desc">
            {fullDate(storyline.firstSeenAt)} → {fullDate(storyline.lastSeenAt)} · {members.length} event {members.length === 1 ? "cluster" : "clusters"} · {storyline.status}
          </p>
        </div>
        <div className="topbar-actions">
          <button className="btn-ghost btn" onClick={refreshLens} disabled={refreshing}>
            {refreshing ? "Refreshing…" : "↻ Refresh lens"}
          </button>
        </div>
      </header>

      <div className="page">
        {/* Arc summary + sentiment pair */}
        <div className="cluster-card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 260 }}>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--ink-40)", marginBottom: 6 }}>The arc so far</div>
              <p style={{ fontSize: 13.5, color: "var(--ink-80)", lineHeight: 1.6, margin: 0 }}>
                {storyline.summary ?? <em style={{ color: "var(--ink-40)" }}>No summary yet — refresh the lens to generate one.</em>}
              </p>
            </div>
            <div style={{ display: "flex", gap: 22, flexShrink: 0 }}>
              <SentStat label="News tone" score={storyline.newsSentimentScore} />
              <SentStat label="Social tone" score={storyline.socialSentimentScore} />
            </div>
          </div>
        </div>

        {/* Platform lens */}
        {lensEntries.length > 0 && (
          <div className="cluster-card" style={{ marginBottom: 16 }}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--ink-40)", marginBottom: 10 }}>
              Platform lens — same story, every angle
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {lensEntries.map(([key, lens]) => (
                <div key={key} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <div style={{ width: 92, flexShrink: 0, paddingTop: 1 }}>
                    {key === "news" ? (
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", color: "var(--ink-60)" }}>▤ News</span>
                    ) : (
                      <PlatformChip platform={key} size="sm" />
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: "var(--ink-80)", lineHeight: 1.5 }}>{lens.digest}</div>
                    {lens.quote && (
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--ink-50)", marginTop: 3, paddingLeft: 10, borderLeft: "2px solid var(--border)" }}>
                        “{lens.quote}”
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Chronology of member clusters */}
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--ink-50)", padding: "0 0 8px", marginBottom: 12, borderBottom: "1px solid var(--border-soft)" }}>
          Chronology — oldest first
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {members.map((m, i) => (
            <div key={m.id} style={{ display: "flex", gap: 14 }}>
              {/* Timeline rail */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 14, flexShrink: 0 }}>
                <span style={{ width: 9, height: 9, borderRadius: 99, marginTop: 6, background: m.isOrigin ? "var(--accent)" : "var(--ink-20)", border: m.isOrigin ? "2px solid color-mix(in oklch, var(--accent) 40%, var(--paper))" : "none", boxSizing: "content-box" }} />
                {i < members.length - 1 && <span style={{ flex: 1, width: 1, background: "var(--border)", margin: "4px 0" }} />}
              </div>

              <div className="cluster-card" style={{ flex: 1, marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8, flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 3 }}>
                      {m.isOrigin && (
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--paper)", background: "var(--accent)", borderRadius: 3, padding: "2px 6px" }}>
                          ◉ Where this started
                        </span>
                      )}
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--ink-40)" }}>
                        {shortDate(m.firstSeenAt)} → {shortDate(m.lastSeenAt)} · {m.itemCount} items
                      </span>
                      {m.sentimentScore != null && (
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, fontWeight: 600, color: sentColor(m.sentimentScore) }}>
                          {m.sentimentScore >= 0 ? "+" : ""}{m.sentimentScore.toFixed(2)}
                        </span>
                      )}
                    </div>
                    <Link href={`/analyst/clusters/${m.id}`} style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.35, color: "var(--ink)", textDecoration: "none" }}>
                      {m.label ?? <em style={{ color: "var(--ink-40)", fontWeight: 400 }}>Unnamed cluster</em>}
                    </Link>
                    {m.narrativeSummary && (
                      <p style={{ fontSize: 12.5, color: "var(--ink-60)", lineHeight: 1.5, margin: "4px 0 0" }}>{m.narrativeSummary}</p>
                    )}
                  </div>
                  <button
                    className="btn-ghost btn"
                    style={{ fontSize: 10, padding: "2px 8px", fontFamily: "var(--font-mono)", letterSpacing: "0.04em", flexShrink: 0 }}
                    disabled={reportingId === m.id}
                    onClick={() => generateBrief(m.id, members.filter((x) => x.id !== m.id).map((x) => x.id))}
                    title="Generate a Signal Brief for this event with the rest of the storyline linked"
                  >
                    {reportingId === m.id ? "Generating…" : "◉ Brief"}
                  </button>
                </div>

                {m.platforms.length > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                    {m.platforms.map((p) => (
                      <span key={p.platform} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <PlatformChip platform={p.platform} size="sm" />
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-40)" }}>{p.itemCount}</span>
                      </span>
                    ))}
                  </div>
                )}

                {m.newsLinks.length > 0 && (
                  <div style={{ margin: "10px 0 0", padding: "8px 10px", background: "color-mix(in oklch, var(--ink) 3%, var(--paper))", border: "1px solid var(--border-soft)", borderRadius: 6 }}>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--ink-40)", marginBottom: 6 }}>
                      ▤ Related news
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                      {m.newsLinks.map((n) => (
                        <div key={n.id} style={{ fontSize: 12, lineHeight: 1.45 }}>
                          <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
                            <span style={{ fontFamily: "var(--font-mono)", fontSize: 8.5, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: n.relationship === "driving" ? "var(--accent)" : "var(--ink-40)", border: `1px solid ${n.relationship === "driving" ? "var(--accent)" : "var(--ink-20)"}`, borderRadius: 3, padding: "0 4px", flexShrink: 0 }}>
                              {n.relationship}
                            </span>
                            {n.url ? (
                              <a href={n.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--ink-80)", fontWeight: 500 }}>
                                {cleanTitle(n.headline)}
                              </a>
                            ) : (
                              <span style={{ color: "var(--ink-80)", fontWeight: 500 }}>{cleanTitle(n.headline)}</span>
                            )}
                            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-30)" }}>{shortDate(n.publishedAt)}</span>
                          </div>
                          {n.explanation && (
                            <div style={{ fontSize: 11.5, color: "var(--ink-50)", marginTop: 1 }}>{n.explanation}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
