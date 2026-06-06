"use client";

import { useEffect, useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { PlatformChip } from "@/components/primitives";
import { useCompany } from "@/components/CompanyContext";
import { VelocitySparkline } from "@/components/VelocitySparkline";
import { ItemAnnotations } from "@/components/ItemAnnotations";
import { AddItemDialog } from "@/components/AddItemDialog";

// ─── Types ────────────────────────────────────────────────────────────────────

type Cluster = {
  id: string;
  entityId: string | null;
  label: string | null;
  itemCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  classification: string;
  effectiveClassification: string;
  narrativeStage: string | null;
  narrativeSummary: string | null;
  momentum: number | null;
  peakMomentum: number | null;
  velocity24h: number | null;
  prevVelocity24h: number | null;
  platformCount: number | null;
  analystClassification: string | null;
  analystNote: string | null;
  sentimentScore: number | null;
  sentimentLabel: string | null;
  suggestedKeywords: string[] | null;
  platforms: string[];
  trackedEntities: Array<{ id: string; label: string }>;
};

type ClusterItem = {
  clusterId: string;
  itemId: string;
  similarity: number;
  itemSignal: string;
  analystSignal: string | null;
  analystNote: string | null;
  analystFlag: string | null;
  mergeId: string | null;
  title: string | null;
  body: string | null;
  url: string | null;
  externalId: string | null;
  platform: string;
  author: string | null;
  publishedAt: string | null;
  ingestedAt: string;
};

type MergeInfo = {
  absorbedLabel: string | null;
  absorbedFirstSeenAt: string;
  absorbedLastSeenAt: string;
  absorbedItemCount: number;
  mergedAt: string;
};

type PeriodNarrative = {
  aiNarrative: string | null;
  analystNarrative: string | null;
};

type ExpandedData = {
  items: ClusterItem[];
  merges: Record<string, MergeInfo>;
  periodNarratives: Record<string, PeriodNarrative>;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function cleanTitle(raw: string | null): string | null {
  if (!raw) return null;
  return raw
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
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

function friendlyDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function ClassificationPill({ classification }: { classification: string }) {
  const styles: Record<string, { label: string; color: string }> = {
    narrative:    { label: "NARRATIVE",    color: "var(--accent)" },
    noise:        { label: "NOISE",        color: "var(--ink-30)" },
    signal:       { label: "SIGNAL",       color: "var(--ok)" },
    watch:        { label: "WATCH",        color: "var(--warn)" },
    unclassified: { label: "UNCLASSIFIED", color: "var(--ink-20)" },
  };
  const s = styles[classification] ?? styles.unclassified;
  return (
    <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: s.color, border: `1px solid ${s.color}`, borderRadius: 3, padding: "1px 5px", lineHeight: 1.4 }}>
      {s.label}
    </span>
  );
}

function SentimentPill({ label }: { label: string }) {
  const styles: Record<string, { color: string; glyph: string }> = {
    positive: { color: "var(--ok)",     glyph: "↑" },
    negative: { color: "var(--err)",    glyph: "↓" },
    neutral:  { color: "var(--ink-40)", glyph: "→" },
    mixed:    { color: "var(--warn)",   glyph: "~" },
  };
  const s = styles[label] ?? styles.neutral;
  return (
    <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: s.color, border: `1px solid ${s.color}`, borderRadius: 3, padding: "1px 5px", lineHeight: 1.4 }}>
      {s.glyph} {label}
    </span>
  );
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

// ─── Main component ───────────────────────────────────────────────────────────

export default function ClusterDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;
  const { activeCompanyId } = useCompany();

  const [cluster, setCluster] = useState<Cluster | null>(null);
  const [expanded, setExpanded] = useState<ExpandedData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Tracked user handles — used to highlight items authored by tracked users
  const [rawTrackedHandles, setRawTrackedHandles] = useState<Array<{ platform: string; username: string }>>([]);

  // Label editing
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState("");
  const [savingLabel, setSavingLabel] = useState(false);

  // Period narrative editing
  const [editingPeriod, setEditingPeriod] = useState<string | null>(null);
  const [periodDraft, setPeriodDraft] = useState("");
  const [savingPeriod, setSavingPeriod] = useState(false);

  // Summary
  const [summaryExpanded, setSummaryExpanded] = useState(false);

  // Actions
  const [analyzingSentiment, setAnalyzingSentiment] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Report modal
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [modalClusters, setModalClusters] = useState<Array<{ id: string; label: string | null; itemCount: number }>>([]);
  const [selectedLinkedIds, setSelectedLinkedIds] = useState<Set<string>>(new Set());
  const [loadingModalClusters, setLoadingModalClusters] = useState(false);

  // Add item
  const [addItemOpen, setAddItemOpen] = useState(false);

  // Load cluster + items in parallel
  useEffect(() => {
    Promise.all([
      fetch(`/api/clusters/${id}`).then((r) => (r.ok ? r.json() : Promise.reject("not found"))),
      fetch(`/api/clusters/${id}/items`).then((r) => (r.ok ? r.json() : Promise.reject("items failed"))),
    ])
      .then(([clusterData, itemsData]: [Cluster, ExpandedData]) => {
        setCluster(clusterData);
        setExpanded(itemsData);
      })
      .catch(() => setError("Cluster not found."));
  }, [id]);

  // Load tracked handles for the active company
  useEffect(() => {
    if (!activeCompanyId) return;
    const cq = `companyId=${activeCompanyId}`;
    Promise.all([
      fetch(`/api/twitter-handles?${cq}`).then((r) => r.json()),
      fetch(`/api/user-handles?${cq}`).then((r) => r.json()),
    ]).then(([twitterRows, userRows]) => {
      const combined: Array<{ platform: string; username: string }> = [
        ...twitterRows.map((h: { handle: string }) => ({ platform: "twitter", username: h.handle })),
        ...userRows.map((h: { platform: string; username: string }) => ({ platform: h.platform, username: h.username })),
      ];
      setRawTrackedHandles(combined);
    });
  }, [activeCompanyId]);

  // Build a fast Set<"platform:username"> for O(1) lookup
  const trackedHandleSet = useMemo(() => {
    const set = new Set<string>();
    for (const h of rawTrackedHandles) {
      set.add(`${h.platform.toLowerCase()}:${h.username.toLowerCase()}`);
    }
    return set;
  }, [rawTrackedHandles]);

  const saveLabel = async () => {
    if (!cluster) return;
    setSavingLabel(true);
    await fetch(`/api/clusters/${id}/label`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: labelDraft.trim() || null }),
    });
    setCluster((c) => c ? { ...c, label: labelDraft.trim() || null } : c);
    setSavingLabel(false);
    setEditingLabel(false);
  };

  const savePeriodNarrative = async (date: string, narrative: string) => {
    setSavingPeriod(true);
    await fetch(`/api/clusters/${id}/period-narrative`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, narrative }),
    });
    setExpanded((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        periodNarratives: {
          ...prev.periodNarratives,
          [date]: { ...(prev.periodNarratives[date] ?? { aiNarrative: null }), analystNarrative: narrative },
        },
      };
    });
    setSavingPeriod(false);
    setEditingPeriod(null);
  };

  const analyzeSentiment = async () => {
    setAnalyzingSentiment(true);
    try {
      const res = await fetch(`/api/clusters/${id}/sentiment`, { method: "POST" });
      if (res.ok) {
        const { sentimentLabel, sentimentScore } = await res.json();
        setCluster((c) => c ? { ...c, sentimentLabel, sentimentScore } : c);
      }
    } finally {
      setAnalyzingSentiment(false);
    }
  };

  const openReportModal = async () => {
    if (!cluster) return;
    setReportModalOpen(true);
    setSelectedLinkedIds(new Set());
    setLoadingModalClusters(true);
    try {
      const res = await fetch(`/api/clusters?entityId=${cluster.entityId}`);
      const { clusters: all } = await res.json();
      setModalClusters(
        (all as Array<{ id: string; label: string | null; itemCount: number }>)
          .filter((c) => c.id !== id)
      );
    } finally {
      setLoadingModalClusters(false);
    }
  };

  const generateReport = async (linkedIds: Set<string>) => {
    setReporting(true);
    setReportModalOpen(false);
    try {
      const res = await fetch(`/api/clusters/${id}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkedClusterIds: [...linkedIds] }),
      });
      const { reportId } = await res.json();
      router.push(`/analyst/report/${reportId}`);
    } catch {
      setReporting(false);
    }
  };

  const deleteCluster = async () => {
    setDeleteBusy(true);
    try {
      await fetch(`/api/clusters/${id}/delete`, { method: "DELETE" });
      router.push("/analyst/clusters");
    } finally {
      setDeleteBusy(false);
    }
  };

  function renderItemRow(item: ClusterItem, i: number) {
    const href =
      item.platform === "hackernews" && item.externalId
        ? `https://news.ycombinator.com/item?id=${item.externalId}`
        : item.url;

    const normalizedAuthor = item.author?.toLowerCase().replace(/^[@]/, "").replace(/^u\//, "") ?? null;
    const isTracked = normalizedAuthor !== null && trackedHandleSet.has(`${item.platform}:${normalizedAuthor}`);
    const authorLabel =
      item.platform === "reddit" ? `u/${normalizedAuthor}`
      : item.platform === "hackernews" ? normalizedAuthor
      : `@${normalizedAuthor}`;

    return (
      <div key={i} className="cluster-item-row">
        <PlatformChip platform={item.platform} size="sm" />
        {isTracked && (
          <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", padding: "1px 6px", borderRadius: 99, background: "color-mix(in oklch, var(--accent) 10%, var(--paper))", color: "var(--accent)", border: "1px solid color-mix(in oklch, var(--accent) 25%, transparent)", whiteSpace: "nowrap", flexShrink: 0 }}>
            {authorLabel}
          </span>
        )}
        <span className="cluster-item-title">
          {href ? (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {cleanTitle(item.title) ?? item.body?.slice(0, 120) ?? href}
            </a>
          ) : (
            cleanTitle(item.title) ?? item.body?.slice(0, 120) ?? "—"
          )}
        </span>
        <ItemAnnotations
          clusterId={id}
          itemId={item.itemId}
          note={item.analystNote}
          flag={item.analystFlag as "review" | "highlight" | null}
          onUpdate={(note, flag) => {
            setExpanded((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                items: prev.items.map((it) =>
                  it.itemId === item.itemId ? { ...it, analystNote: note, analystFlag: flag } : it
                ),
              };
            });
          }}
        />
      </div>
    );
  }

  // ── Loading / error states ────────────────────────────────────────────────

  if (error) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh", color: "var(--ink-50)", fontFamily: "var(--font-mono)", fontSize: 13 }}>
        {error}
      </div>
    );
  }

  if (!cluster || !expanded) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh", color: "var(--ink-50)", fontFamily: "var(--font-mono)", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.1em" }}>
        Loading…
      </div>
    );
  }

  // ── Build date-grouped items ──────────────────────────────────────────────

  const byDay = new Map<string, ClusterItem[]>();
  for (const item of expanded.items) {
    const day = item.ingestedAt.slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(item);
  }
  const dayGroups = [...byDay.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([day, dayItems]) => [day, [...dayItems].sort((a, b) => b.ingestedAt.localeCompare(a.ingestedAt))] as [string, ClusterItem[]]);
  const multiDay = dayGroups.length > 1;

  const mergeList = Object.values(expanded.merges);

  return (
    <>
      {/* Report — linked cluster selection modal */}
      {reportModalOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setReportModalOpen(false)}>
          <div style={{ background: "var(--paper)", border: "1px solid var(--border)", borderRadius: 8, boxShadow: "0 8px 32px rgba(0,0,0,0.18)", width: 480, maxWidth: "90vw", maxHeight: "80vh", display: "flex", flexDirection: "column" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ padding: "20px 24px 0" }}>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Link clusters to this brief</div>
              <p style={{ fontSize: 13, color: "var(--ink-60)", margin: "0 0 16px", lineHeight: 1.5 }}>
                Select other clusters to include in the analysis. Their items and notes will be sent to the AI alongside this cluster.
              </p>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "0 24px" }}>
              {loadingModalClusters ? (
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-40)", padding: "12px 0" }}>Loading clusters…</div>
              ) : modalClusters.length === 0 ? (
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-40)", fontStyle: "italic", padding: "12px 0" }}>No other clusters for this entity.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {modalClusters.map((c) => {
                    const checked = selectedLinkedIds.has(c.id);
                    return (
                      <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 6, cursor: "pointer", background: checked ? "color-mix(in oklch, var(--accent) 8%, var(--paper))" : "transparent", border: `1px solid ${checked ? "color-mix(in oklch, var(--accent) 30%, transparent)" : "transparent"}` }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            setSelectedLinkedIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(c.id)) next.delete(c.id);
                              else next.add(c.id);
                              return next;
                            });
                          }}
                          style={{ accentColor: "var(--accent)", width: 14, height: 14, flexShrink: 0 }}
                        />
                        <span style={{ flex: 1, fontSize: 13, lineHeight: 1.4, color: c.label ? "var(--ink)" : "var(--ink-40)", fontStyle: c.label ? "normal" : "italic" }}>
                          {c.label ?? "Unnamed cluster"}
                        </span>
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-40)", whiteSpace: "nowrap" }}>{c.itemCount} items</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
            <div style={{ padding: "16px 24px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--border-soft)", marginTop: 12 }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-40)" }}>
                {selectedLinkedIds.size > 0 ? `${selectedLinkedIds.size} cluster${selectedLinkedIds.size !== 1 ? "s" : ""} linked` : "No additional clusters selected"}
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn-ghost btn" style={{ fontSize: 12 }} onClick={() => setReportModalOpen(false)}>Cancel</button>
                <button
                  className="btn"
                  style={{ fontSize: 12 }}
                  disabled={reporting}
                  onClick={() => generateReport(selectedLinkedIds)}
                >
                  {reporting ? "Generating…" : "Generate Brief"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm modal */}
      {deleteConfirm && (
        <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "var(--paper)", border: "1px solid var(--border)", borderRadius: 8, boxShadow: "0 8px 32px rgba(0,0,0,0.18)", width: 400, maxWidth: "90vw", padding: 24 }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Delete cluster?</div>
            <p style={{ fontSize: 13, color: "var(--ink-60)", marginBottom: 20, lineHeight: 1.5 }}>
              <strong>{cluster.label ?? "Unnamed cluster"}</strong> and all its ingested items will be permanently deleted. This cannot be undone.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button className="btn-ghost btn" onClick={() => setDeleteConfirm(false)} disabled={deleteBusy}>Cancel</button>
              <button
                className="btn"
                style={{ background: "var(--err)", color: "#fff", borderColor: "var(--err)" }}
                onClick={deleteCluster}
                disabled={deleteBusy}
              >
                {deleteBusy ? "Deleting…" : "Delete cluster"}
              </button>
            </div>
          </div>
        </div>
      )}

      {addItemOpen && (
        <AddItemDialog
          clusterId={id}
          clusterEntityId={cluster.entityId}
          onAdded={async () => {
            const res = await fetch(`/api/clusters/${id}/items`);
            const data = await res.json();
            setExpanded(data);
          }}
          onClose={() => setAddItemOpen(false)}
        />
      )}

      <header className="topbar">
        <div>
          <button
            onClick={() => router.push("/analyst/clusters")}
            style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-40)", letterSpacing: "0.05em", padding: "0 0 8px", display: "flex", alignItems: "center", gap: 4 }}
          >
            ← Clusters
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
            <ClassificationPill classification={cluster.effectiveClassification} />
            {cluster.sentimentLabel && <SentimentPill label={cluster.sentimentLabel} />}
            {cluster.momentum != null && cluster.momentum > 0 && (
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-40)" }}>↑{cluster.momentum.toFixed(1)}/day</span>
            )}
          </div>
          {editingLabel ? (
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 2 }}>
              <input
                autoFocus
                value={labelDraft}
                onChange={(e) => setLabelDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") saveLabel(); if (e.key === "Escape") setEditingLabel(false); }}
                placeholder="Cluster name"
                style={{ fontSize: 22, fontWeight: 600, fontFamily: "inherit", border: "1px solid var(--accent)", borderRadius: 4, padding: "2px 8px", background: "var(--paper)", color: "var(--ink-80)", minWidth: 280 }}
              />
              <button className="btn" style={{ fontSize: 12, padding: "4px 10px" }} disabled={savingLabel} onClick={saveLabel}>{savingLabel ? "…" : "Save"}</button>
              <button className="btn-ghost btn" style={{ fontSize: 12, padding: "4px 10px" }} onClick={() => setEditingLabel(false)}>Cancel</button>
            </div>
          ) : (
            <h1
              className="page-title"
              style={{ cursor: "text", display: "inline-block" }}
              title="Click to rename"
              onClick={() => { setEditingLabel(true); setLabelDraft(cluster.label ?? ""); }}
            >
              {cluster.label ?? <span style={{ color: "var(--ink-40)", fontWeight: 400, fontStyle: "italic" }}>Unnamed cluster</span>}
            </h1>
          )}
          <p className="page-desc" style={{ marginTop: 4 }}>
            {shortDate(cluster.firstSeenAt)} → {relativeTime(cluster.lastSeenAt)} · {cluster.itemCount} items
            {cluster.platforms.length > 0 && (
              <> · {cluster.platforms.join(", ")}</>
            )}
          </p>
        </div>
        <div className="topbar-actions">
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {cluster.narrativeStage && cluster.itemCount >= 2 && (
              <VelocitySparkline clusterId={id} stage={cluster.narrativeStage} firstSeenAt={cluster.firstSeenAt} />
            )}
            <button
              className="btn-ghost btn"
              style={{ fontSize: 11, fontFamily: "var(--font-mono)", letterSpacing: "0.04em" }}
              onClick={analyzeSentiment}
              disabled={analyzingSentiment}
              title="Re-analyze sentiment"
            >
              {analyzingSentiment ? "Analyzing…" : "◎ Sentiment"}
            </button>
            <button
              className="btn-ghost btn"
              style={{ fontSize: 11, fontFamily: "var(--font-mono)", letterSpacing: "0.04em" }}
              onClick={openReportModal}
              disabled={reporting}
              title="Generate Signal Brief"
            >
              {reporting ? "Generating…" : "◉ Report"}
            </button>
            <button
              className="btn-ghost btn"
              style={{ fontSize: 11, fontFamily: "var(--font-mono)", letterSpacing: "0.04em", color: "var(--err)", borderColor: "color-mix(in oklch, var(--err) 30%, transparent)" }}
              onClick={() => setDeleteConfirm(true)}
              title="Delete this cluster"
            >
              ✕ Delete
            </button>
          </div>
        </div>
      </header>

      <div className="page">

        {/* Narrative summary */}
        {cluster.narrativeSummary && cluster.effectiveClassification === "narrative" && (
          <div style={{ marginBottom: 16 }}>
            <button
              onClick={() => setSummaryExpanded((v) => !v)}
              style={{ background: "none", border: "none", cursor: "pointer", padding: "3px 0", fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--ink-40)", textTransform: "uppercase", letterSpacing: "0.06em", display: "flex", alignItems: "center", gap: 4 }}
            >
              {summaryExpanded ? "▾" : "▸"} Narrative Summary
            </button>
            {summaryExpanded && (
              <p style={{ fontSize: 13, color: "var(--ink-60)", lineHeight: 1.5, margin: "4px 0 0", padding: "8px 10px", background: "color-mix(in oklch, var(--accent) 6%, var(--paper))", borderLeft: "2px solid var(--accent)", borderRadius: "0 4px 4px 0" }}>
                {cluster.narrativeSummary}
              </p>
            )}
          </div>
        )}

        {/* Tracked entities + keywords */}
        {(cluster.trackedEntities?.length > 0 || (cluster.suggestedKeywords && cluster.suggestedKeywords.length > 0)) && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 16, alignItems: "center" }}>
            {cluster.trackedEntities?.map((e) => (
              <span key={e.id} style={{ fontSize: 10, fontFamily: "var(--font-mono)", padding: "2px 8px", borderRadius: 99, background: "color-mix(in oklch, var(--accent) 8%, var(--paper))", color: "var(--ink-60)", border: "1px solid color-mix(in oklch, var(--accent) 18%, transparent)", whiteSpace: "nowrap" }}>
                {e.label}
              </span>
            ))}
            {cluster.suggestedKeywords && cluster.suggestedKeywords.length > 0 && (
              <>
                <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-30)", marginLeft: 4 }}>suggested</span>
                {cluster.suggestedKeywords.map((kw) => (
                  <span key={kw} style={{ fontSize: 10, fontFamily: "var(--font-mono)", padding: "2px 8px", borderRadius: 99, background: "color-mix(in oklch, var(--warn) 8%, var(--paper))", color: "color-mix(in oklch, var(--warn) 70%, var(--ink))", border: "1px solid color-mix(in oklch, var(--warn) 25%, transparent)", whiteSpace: "nowrap" }}>
                    {kw}
                  </span>
                ))}
              </>
            )}
          </div>
        )}

        {/* ── Items ──────────────────────────────────────────────────────────── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontFamily: "var(--font-mono)", fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--ink-50)", padding: "0 0 8px", marginBottom: 10, borderBottom: "1px solid var(--border-soft)" }}>
          <span>Items</span>
          <span style={{ fontSize: 10, color: "var(--ink-40)" }}>{expanded.items.length} total</span>
        </div>

        {expanded.items.length === 0 ? (
          <div style={{ color: "var(--ink-40)", fontFamily: "var(--font-mono)", fontSize: 12, fontStyle: "italic", padding: "16px 0" }}>No items yet.</div>
        ) : (
          <div className="cluster-card-items" style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px", background: "var(--paper)" }}>
            {dayGroups.map(([day, dayItems], gi) => {
              const pn = expanded.periodNarratives[day];
              const periodText = pn?.analystNarrative ?? pn?.aiNarrative ?? null;
              const isEditingThis = editingPeriod === day;
              return (
                <div key={day}>
                  {multiDay && <WaveHeader label={shortDate(day + "T12:00:00Z")} isFirst={gi === 0} />}
                  {isEditingThis ? (
                    <div style={{ display: "flex", gap: 6, alignItems: "flex-start", marginBottom: 6, padding: "4px 0" }}>
                      <textarea
                        autoFocus
                        value={periodDraft}
                        onChange={(e) => setPeriodDraft(e.target.value)}
                        rows={2}
                        style={{ flex: 1, fontSize: 12, fontFamily: "inherit", color: "var(--ink-60)", background: "var(--paper)", border: "1px solid var(--accent)", borderRadius: 4, padding: "4px 6px", resize: "vertical" }}
                      />
                      <button className="btn" style={{ fontSize: 11, padding: "3px 8px" }} disabled={savingPeriod} onClick={() => savePeriodNarrative(day, periodDraft)}>
                        {savingPeriod ? "…" : "Save"}
                      </button>
                      <button className="btn-ghost btn" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => setEditingPeriod(null)}>Cancel</button>
                    </div>
                  ) : (
                    <div
                      style={{ fontSize: 12, color: "var(--ink-50)", lineHeight: 1.5, marginBottom: 4, padding: "3px 0", cursor: "pointer", fontStyle: periodText ? "normal" : "italic" }}
                      title="Click to edit period note"
                      onClick={() => { setEditingPeriod(day); setPeriodDraft(periodText ?? ""); }}
                    >
                      {periodText ?? <span style={{ opacity: 0.4 }}>Add note…</span>}
                    </div>
                  )}
                  {dayItems.map((item, i) => renderItemRow(item, i))}
                </div>
              );
            })}
            <div style={{ paddingTop: 8, display: "flex", justifyContent: "flex-end" }}>
              <button
                className="btn btn-ghost"
                style={{ fontSize: 11, fontFamily: "var(--font-mono)", letterSpacing: "0.05em" }}
                onClick={() => setAddItemOpen(true)}
              >
                + Add item
              </button>
            </div>
          </div>
        )}

        {/* ── Merge history ──────────────────────────────────────────────────── */}
        {mergeList.length > 0 && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontFamily: "var(--font-mono)", fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--ink-50)", padding: "0 0 8px", margin: "24px 0 10px", borderBottom: "1px solid var(--border-soft)" }}>
              <span>Merge history</span>
              <span style={{ fontSize: 10, color: "var(--ink-40)" }}>{mergeList.length} cluster{mergeList.length !== 1 ? "s" : ""} absorbed</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {mergeList.map((m, i) => (
                <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 10, fontSize: 13, padding: "8px 12px", background: "var(--paper)", border: "1px solid var(--border)", borderRadius: 6, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 500, flex: 1 }}>{m.absorbedLabel ?? <em style={{ color: "var(--ink-40)", fontWeight: 400 }}>Unnamed</em>}</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-40)", whiteSpace: "nowrap" }}>{m.absorbedItemCount} items</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-30)", whiteSpace: "nowrap" }}>
                    {friendlyDate(m.absorbedFirstSeenAt)} → {friendlyDate(m.absorbedLastSeenAt)}
                  </span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-25, var(--ink-30))", whiteSpace: "nowrap" }}>
                    merged {relativeTime(m.mergedAt)}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
