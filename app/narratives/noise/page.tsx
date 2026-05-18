"use client";

import { useEffect, useState, useCallback } from "react";
import { PlatformChip } from "@/components/primitives";
import { useCompany } from "@/components/CompanyContext";
import { StagePill } from "@/components/StagePill";

type ClusterItem = {
  clusterId: string;
  itemId: string;
  similarity: number;
  itemSignal: string;
  analystSignal: string | null;
  signalReason: string | null;
  mergeId: string | null;
  title: string | null;
  body: string | null;
  url: string | null;
  externalId: string | null;
  platform: string;
  publishedAt: string | null;
  ingestedAt: string;
};

type MergeInfo = {
  absorbedLabel: string | null;
  absorbedItemCount: number;
  mergedAt: string;
  ingestedFirstAt: string;
  ingestedLastAt: string;
};

type PeriodNarrative = { aiNarrative: string | null; analystNarrative: string | null };

type ExpandedData = {
  items: ClusterItem[];
  merges: Record<string, MergeInfo>;
  periodNarratives: Record<string, PeriodNarrative>;
};

type Cluster = {
  id: string;
  label: string | null;
  itemCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  analystClassification: string | null;
  analystNote: string | null;
  narrativeSummary: string | null;
  narrativeStage: string | null;
  velocity24h: number | null;
  prevVelocity24h: number | null;
  peakMomentum: number | null;
  topItems: ClusterItem[];
  platforms: string[];
  trackedEntities: Array<{ id: string; label: string }>;
};

function cleanTitle(raw: string | null): string | null {
  if (!raw) return null;
  return raw
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(Number(c)))
    .trim() || null;
}

function relativeTime(iso: string | null) {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function shortDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function WaveHeader({ label, isFirst }: { label: string; isFirst: boolean }) {
  return (
    <div style={{
      fontFamily: "var(--font-mono)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em",
      color: "var(--ink-30)", padding: "5px 0 3px",
      borderTop: isFirst ? "none" : "1px solid var(--border-soft)", marginTop: isFirst ? 0 : 6,
    }}>
      {label}
    </div>
  );
}

export default function NoisePage() {
  const { activeCompanyId } = useCompany();
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [expandedData, setExpandedData] = useState<Record<string, ExpandedData>>({});
  const [editingPeriod, setEditingPeriod] = useState<{ clusterId: string; date: string } | null>(null);
  const [editingPeriodDraft, setEditingPeriodDraft] = useState("");
  const [savingPeriod, setSavingPeriod] = useState(false);
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [editingLabelDraft, setEditingLabelDraft] = useState("");
  const [savingLabel, setSavingLabel] = useState(false);

  const fetchClusters = useCallback(async () => {
    if (!activeCompanyId) return;
    setLoading(true);
    const params = new URLSearchParams({ analystClassification: "noise", sort: "activity", companyId: activeCompanyId });
    const res = await fetch(`/api/clusters?${params}`);
    const data = await res.json();
    setClusters(data.clusters ?? []);
    setLoading(false);
  }, [activeCompanyId]);

  useEffect(() => { fetchClusters(); }, [fetchClusters]);

  const toggleExpand = useCallback(async (id: string) => {
    if (expandedIds.has(id)) {
      setExpandedIds((prev) => { const s = new Set(prev); s.delete(id); return s; });
      return;
    }
    if (!expandedData[id]) {
      const res = await fetch(`/api/clusters/${id}/items`);
      const data: ExpandedData = await res.json();
      setExpandedData((prev) => ({ ...prev, [id]: data }));
    }
    setExpandedIds((prev) => new Set(prev).add(id));
  }, [expandedIds, expandedData]);

  const savePeriodNarrative = useCallback(async (clusterId: string, date: string, narrative: string) => {
    setSavingPeriod(true);
    await fetch(`/api/clusters/${clusterId}/period-narrative`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, narrative }),
    });
    setExpandedData((prev) => {
      const cluster = prev[clusterId];
      if (!cluster) return prev;
      return {
        ...prev,
        [clusterId]: {
          ...cluster,
          periodNarratives: {
            ...cluster.periodNarratives,
            [date]: { ...(cluster.periodNarratives[date] ?? { aiNarrative: null }), analystNarrative: narrative },
          },
        },
      };
    });
    setEditingPeriod(null);
    setSavingPeriod(false);
  }, []);

  const classifyCluster = async (clusterId: string, classification: "signal" | "watch" | "noise" | null) => {
    await fetch(`/api/clusters/${clusterId}/classify`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classification }),
    });
    setClusters((prev) =>
      prev.map((c) => c.id === clusterId ? { ...c, analystClassification: classification } : c)
    );
  };

  const saveLabel = async (clusterId: string, label: string) => {
    setSavingLabel(true);
    await fetch(`/api/clusters/${clusterId}/label`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: label.trim() || null }),
    });
    setClusters((prev) => prev.map((c) => c.id === clusterId ? { ...c, label: label.trim() || null } : c));
    setSavingLabel(false);
    setEditingLabelId(null);
  };

  return (
    <>
      <header className="topbar">
        <div>
          <div className="eyebrow">Part 3 · Narratives</div>
          <h1 className="page-title">Noise</h1>
          <p className="page-desc">Clusters the analyst has reviewed and confirmed as noise. May still contain narrative patterns.</p>
        </div>
      </header>

      <div className="page">
        <div className="kpi-row">
          <div className="kpi">
            <div className="kpi-top"><div className="kpi-label">Noise clusters</div></div>
            <div className="kpi-mid">
              <div className="kpi-value">{loading ? "—" : clusters.length}</div>
              <div className="kpi-delta kpi-delta-flat">→ analyst reviewed</div>
            </div>
          </div>
          <div className="kpi">
            <div className="kpi-top"><div className="kpi-label">Total items</div></div>
            <div className="kpi-mid">
              <div className="kpi-value">{loading ? "—" : clusters.reduce((s, c) => s + c.itemCount, 0)}</div>
              <div className="kpi-delta kpi-delta-flat">→ across noise clusters</div>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="empty"><div className="empty-mark">⧖</div><div className="empty-title">Loading…</div></div>
        ) : clusters.length === 0 ? (
          <div className="empty">
            <div className="empty-mark">◇</div>
            <div className="empty-title">No noise clusters yet</div>
            <div className="empty-sub">Use the ⋯ menu on a cluster in Cluster Review to mark it as Noise.</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {clusters.map((cluster) => {
              const isExpanded = expandedIds.has(cluster.id);
              const expanded = expandedData[cluster.id];
              const displayItems = isExpanded ? (expanded?.items ?? cluster.topItems) : cluster.topItems;
              return (
                <div key={cluster.id} className="cluster-card" style={{ padding: 16, opacity: 0.85 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 8 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ marginBottom: 6, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span style={{
                          fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 700, letterSpacing: "0.1em",
                          textTransform: "uppercase", color: "var(--ink-40)",
                          border: "1px solid var(--ink-20)", borderRadius: 3, padding: "1px 5px",
                        }}>
                          NOISE
                        </span>
                        <span style={{
                          fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.08em",
                          textTransform: "uppercase", color: "var(--ink-40)",
                          border: "1px solid var(--border)", borderRadius: 3, padding: "1px 5px",
                        }}>
                          ANALYST REVIEWED
                        </span>
                        {cluster.narrativeStage && (
                          <StagePill stage={cluster.narrativeStage} velocity24h={cluster.velocity24h} prevVelocity24h={cluster.prevVelocity24h} peakMomentum={cluster.peakMomentum} firstSeenAt={cluster.firstSeenAt} />
                        )}
                      </div>
                      <div style={{ fontSize: 15, fontWeight: 600, color: "var(--ink-60)", lineHeight: 1.3, marginBottom: 6 }}>
                        {editingLabelId === cluster.id ? (
                          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <input
                              autoFocus
                              value={editingLabelDraft}
                              onChange={(e) => setEditingLabelDraft(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") saveLabel(cluster.id, editingLabelDraft); if (e.key === "Escape") setEditingLabelId(null); }}
                              placeholder="Cluster name"
                              style={{ flex: 1, fontSize: 14, fontWeight: 600, fontFamily: "inherit", border: "1px solid var(--accent)", borderRadius: 4, padding: "2px 7px", background: "var(--paper)", color: "var(--ink-80)" }}
                            />
                            <button className="btn" style={{ fontSize: 11, padding: "2px 8px" }} disabled={savingLabel} onClick={() => saveLabel(cluster.id, editingLabelDraft)}>{savingLabel ? "…" : "Save"}</button>
                            <button className="btn-ghost btn" style={{ fontSize: 11, padding: "2px 8px" }} onClick={() => setEditingLabelId(null)}>Cancel</button>
                          </div>
                        ) : (
                          <span style={{ cursor: "text" }} title="Click to edit name" onClick={() => { setEditingLabelId(cluster.id); setEditingLabelDraft(cluster.label ?? ""); }}>
                            {cluster.label ?? <span style={{ color: "var(--ink-30)", fontWeight: 400, fontStyle: "italic" }}>Unnamed cluster</span>}
                          </span>
                        )}
                      </div>
                      {cluster.analystNote && (
                        <div style={{ fontSize: 11, color: "var(--ink-40)", fontStyle: "italic", marginBottom: 6 }}>
                          "{cluster.analystNote}"
                        </div>
                      )}
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-30)", textTransform: "uppercase", letterSpacing: "0.06em", marginRight: 2 }}>Mark:</span>
                        {(["signal", "watch", "noise"] as const).map((val) => {
                          const active = cluster.analystClassification === val;
                          const color = val === "signal" ? "var(--ok)" : val === "watch" ? "var(--accent)" : "var(--ink-40)";
                          return (
                            <button
                              key={val}
                              onClick={() => classifyCluster(cluster.id, active ? null : val)}
                              style={{
                                fontSize: 10, fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.06em",
                                padding: "2px 8px", borderRadius: 99,
                                border: `1px solid ${active ? color : "var(--border)"}`,
                                background: active ? `color-mix(in oklch, ${color} 15%, var(--paper))` : "transparent",
                                color: active ? color : "var(--ink-40)", cursor: "pointer",
                              }}
                            >
                              {val}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-30)", flexShrink: 0, textAlign: "right" }}>
                      <div>{cluster.itemCount} items</div>
                    </div>
                  </div>
                  <div className="cluster-card-meta">{shortDate(cluster.firstSeenAt)} → {relativeTime(cluster.lastSeenAt)}</div>

                  {(() => {
                    const renderItem = (item: ClusterItem, i: number) => {
                      const href = item.platform === "hackernews" && item.externalId
                        ? `https://news.ycombinator.com/item?id=${item.externalId}`
                        : item.url;
                      return (
                        <div key={i} className="cluster-item-row" style={{ alignItems: "flex-start", gap: 6 }}>
                          <PlatformChip platform={item.platform} size="sm" />
                          <span className="cluster-item-title" style={{ flex: 1, color: "var(--ink-50)" }}>
                            {href ? (
                              <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: "var(--ink-50)" }}>
                                {cleanTitle(item.title) ?? item.body?.slice(0, 140) ?? href}
                              </a>
                            ) : (
                              cleanTitle(item.title) ?? item.body?.slice(0, 140) ?? "—"
                            )}
                          </span>
                        </div>
                      );
                    };
                    const periodNarratives = isExpanded ? (expanded?.periodNarratives ?? {}) : {};
                    const byDay = new Map<string, ClusterItem[]>();
                    for (const item of displayItems) {
                      const day = item.ingestedAt.slice(0, 10);
                      if (!byDay.has(day)) byDay.set(day, []);
                      byDay.get(day)!.push(item);
                    }
                    const dayGroups = [...byDay.entries()].sort(
                      (a, b) => new Date(b[1][0].ingestedAt).getTime() - new Date(a[1][0].ingestedAt).getTime()
                    );
                    const multiDay = dayGroups.length > 1;
                    return (
                      <div className="cluster-card-items">
                        {dayGroups.map(([day, dayItems], gi) => {
                          const pn = periodNarratives[day];
                          const periodText = pn?.analystNarrative ?? pn?.aiNarrative ?? null;
                          const isEditingThis = editingPeriod?.clusterId === cluster.id && editingPeriod?.date === day;
                          const sortedItems = [...dayItems].sort(
                            (a, b) => new Date(b.ingestedAt).getTime() - new Date(a.ingestedAt).getTime()
                          );
                          return (
                            <div key={day}>
                              {multiDay && <WaveHeader label={shortDate(day + "T12:00:00Z")} isFirst={gi === 0} />}
                              {isExpanded && (
                                isEditingThis ? (
                                  <div style={{ marginBottom: 6 }}>
                                    <textarea
                                      autoFocus
                                      value={editingPeriodDraft}
                                      onChange={(e) => setEditingPeriodDraft(e.target.value)}
                                      rows={2}
                                      style={{
                                        width: "100%", fontSize: 12, fontFamily: "var(--font-sans)",
                                        color: "var(--ink-60)", background: "var(--paper)",
                                        border: "1px solid var(--accent)", borderRadius: 4,
                                        padding: "4px 6px", resize: "vertical", boxSizing: "border-box",
                                      }}
                                    />
                                    <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                                      <button
                                        className="cluster-card-more"
                                        disabled={savingPeriod}
                                        onClick={() => savePeriodNarrative(cluster.id, day, editingPeriodDraft)}
                                      >
                                        {savingPeriod ? "saving…" : "save"}
                                      </button>
                                      <button className="cluster-card-more" onClick={() => setEditingPeriod(null)}>cancel</button>
                                    </div>
                                  </div>
                                ) : (
                                  <div
                                    onClick={() => { setEditingPeriod({ clusterId: cluster.id, date: day }); setEditingPeriodDraft(periodText ?? ""); }}
                                    style={{
                                      fontSize: 12, color: "var(--ink-50)", lineHeight: 1.45,
                                      marginBottom: 5, cursor: "text",
                                      fontStyle: periodText ? "normal" : "italic",
                                    }}
                                  >
                                    {periodText ?? <span style={{ color: "var(--ink-30)" }}>Add note for {shortDate(day + "T12:00:00Z")}…</span>}
                                  </div>
                                )
                              )}
                              {sortedItems.map(renderItem)}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}

                  <div className="cluster-card-foot" style={{ marginTop: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-40)" }}>Source</span>
                      {cluster.platforms.map((p) => <PlatformChip key={p} platform={p} size="sm" />)}
                    </div>
                    {cluster.itemCount > 3 && (
                      <button className="cluster-card-more" onClick={() => toggleExpand(cluster.id)}>
                        {isExpanded ? "show less" : `+ ${cluster.itemCount - 3} more`}
                      </button>
                    )}
                  </div>
                  {cluster.trackedEntities?.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6, paddingTop: 6, borderTop: "1px solid var(--ink-10)" }}>
                      {cluster.trackedEntities.map((e) => (
                        <span key={e.id} style={{ fontSize: 10, fontFamily: "var(--font-mono)", padding: "2px 8px", borderRadius: 99, background: "color-mix(in oklch, var(--accent) 8%, var(--paper))", color: "var(--ink-60)", border: "1px solid color-mix(in oklch, var(--accent) 18%, transparent)", whiteSpace: "nowrap" }}>
                          {e.label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
