"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { cx, PlatformChip } from "@/components/primitives";
import { VelocitySparkline } from "@/components/VelocitySparkline";
import { useCompany } from "@/components/CompanyContext";
import { StageKey } from "@/components/StagePill";
import { AddItemDialog } from "@/components/AddItemDialog";
import { ItemAnnotations } from "@/components/ItemAnnotations";
import ThreadIngestDialog from "@/components/ThreadIngestDialog";
import XReplyIngestDialog from "@/components/XReplyIngestDialog";
import InstagramCommentIngestDialog from "@/components/InstagramCommentIngestDialog";

// ─── Types ───────────────────────────────────────────────────────────────────

type MergeInfo = {
  absorbedLabel: string | null;
  absorbedFirstSeenAt: string;
  absorbedLastSeenAt: string;
  absorbedItemCount: number;
  mergedAt: string;
  ingestedFirstAt: string;
  ingestedLastAt: string;
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
  publishedAt: string | null;
  ingestedAt: string;
};

type PeriodNarrative = { aiNarrative: string | null; analystNarrative: string | null };

type NewsLink = {
  id: string;
  headline: string;
  url: string | null;
  publishedAt: string | null;
  relationship: string; // 'driving' | 'related'
  explanation: string | null;
};

type ExpandedData = {
  items: ClusterItem[];
  merges: Record<string, MergeInfo>;
  periodNarratives: Record<string, PeriodNarrative>;
  newsLinks?: NewsLink[];
};

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
  topItems: ClusterItem[];
  platforms: string[];
  trackedEntities: Array<{ id: string; label: string }>;
  newsLinkCount: number;
};

type Stats = { total: number; avgSize: string; itemsClustered: number; totalItems: number };
type Entity = { id: string; label: string };
type Point = { x: number; y: number };

type MergeSuggestion = {
  id: string;
  entityId: string;
  suggestedLabel: string | null;
  confidence: number | null;
  reason: string | null;
  clusters: Array<{ id: string; label: string | null; itemCount: number; effectiveClassification: string }>;
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

// News is never part of cluster membership — it renders in its own block so the
// social conversation and the related coverage stay visually separate.
function RelatedNewsBlock({ links }: { links: NewsLink[] }) {
  if (links.length === 0) return null;
  return (
    <div style={{ margin: "6px 0 10px", padding: "8px 10px", background: "color-mix(in oklch, var(--ink) 3%, var(--paper))", border: "1px solid var(--border-soft)", borderRadius: 6 }}>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--ink-40)", marginBottom: 6 }}>
        ▤ Related news
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {links.map((n) => (
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
  );
}

// ─── Merge Modal ─────────────────────────────────────────────────────────────

type MergeModalState = {
  selected: Cluster[];
  label: string;
  classification: string | null;
  hasConflict: boolean;
};

function MergeModal({
  state,
  onChange,
  onConfirm,
  onCancel,
  busy,
}: {
  state: MergeModalState;
  onChange: (patch: Partial<MergeModalState>) => void;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const classOptions: Array<{ value: string; label: string }> = [
    { value: "narrative",    label: "Narrative" },
    { value: "noise",        label: "Noise" },
    { value: "unclassified", label: "Unclassified" },
  ];
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "var(--paper)", border: "1px solid var(--border)", borderRadius: 8, boxShadow: "0 8px 32px rgba(0,0,0,0.18)", width: 480, maxWidth: "90vw", padding: 24 }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>
          Merge {state.selected.length} clusters
        </div>

        {/* Selected clusters summary */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 20, background: "var(--ink-05, color-mix(in oklch, var(--ink) 4%, var(--paper)))", borderRadius: 6, padding: "10px 12px" }}>
          {state.selected.map((c) => (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <ClassificationPill classification={c.effectiveClassification} />
              <span style={{ flex: 1, fontWeight: 500 }}>{c.label ?? <em style={{ color: "var(--ink-40)", fontWeight: 400 }}>Unnamed</em>}</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-40)" }}>{c.itemCount} items</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-30)" }}>
                {shortDate(c.firstSeenAt)} → {relativeTime(c.lastSeenAt)}
              </span>
            </div>
          ))}
        </div>

        {/* Label */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 5, color: "var(--ink-60)" }}>Cluster name</div>
          <input
            value={state.label}
            onChange={(e) => onChange({ label: e.target.value })}
            placeholder="Cluster name (optional)"
            style={{ width: "100%", padding: "7px 10px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 5, background: "var(--paper)", color: "var(--ink-80)", boxSizing: "border-box" }}
          />
        </div>

        {/* Classification */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6, color: "var(--ink-60)", display: "flex", alignItems: "center", gap: 6 }}>
            Classification
            {state.hasConflict && (
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--warn)", border: "1px solid var(--warn)", borderRadius: 3, padding: "1px 5px" }}>CONFLICT</span>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {classOptions.map((opt) => (
              <label key={opt.value} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13, cursor: "pointer", padding: "5px 10px", borderRadius: 5, border: `1px solid ${state.classification === opt.value ? "var(--accent)" : "var(--border)"}`, background: state.classification === opt.value ? "color-mix(in oklch, var(--accent) 8%, var(--paper))" : "transparent" }}>
                <input type="radio" name="merge-class" value={opt.value} checked={state.classification === opt.value} onChange={() => onChange({ classification: opt.value })} style={{ accentColor: "var(--accent)" }} />
                {opt.label}
              </label>
            ))}
          </div>
          {state.hasConflict && !state.classification && (
            <div style={{ fontSize: 11, color: "var(--warn)", marginTop: 5 }}>Please choose a classification to continue.</div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button className="btn-ghost btn" onClick={onCancel} disabled={busy}>Cancel</button>
          <button
            className="btn"
            style={{ background: "var(--ink)", color: "var(--paper)", borderColor: "var(--ink)" }}
            onClick={onConfirm}
            disabled={!state.classification || busy}
          >
            {busy ? "Merging…" : `Merge ${state.selected.length} clusters`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ClustersPage() {
  const { activeCompanyId } = useCompany();
  const router = useRouter();
  const [reportingId, setReportingId] = useState<string | null>(null);
  const [analyzingSentimentId, setAnalyzingSentimentId] = useState<string | null>(null);
  const [clusterList, setClusterList] = useState<Cluster[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [entityId, setEntityId] = useState("all");
  const [sort, setSort] = useState("activity");
  const [hideSingletons, setHideSingletons] = useState(true);

  const [loading, setLoading] = useState(true);
  const [clusterRunning, setClusterRunning] = useState(false);
  const [clusterResult, setClusterResult] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [expandedData, setExpandedData] = useState<Record<string, ExpandedData>>({});
  const [expandLoading, setExpandLoading] = useState<Set<string>>(new Set());
  const [summaryExpanded, setSummaryExpanded] = useState<Set<string>>(new Set());
  const [editingPeriod, setEditingPeriod] = useState<{ clusterId: string; date: string } | null>(null);
  const [editingPeriodDraft, setEditingPeriodDraft] = useState("");
  const [savingPeriod, setSavingPeriod] = useState(false);
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [editingLabelDraft, setEditingLabelDraft] = useState("");
  const [savingLabel, setSavingLabel] = useState(false);

  const [threadDialogOpen, setThreadDialogOpen] = useState(false);

  // Merge suggestions (LLM-proposed, analyst-approved)
  const [suggestions, setSuggestions] = useState<MergeSuggestion[]>([]);
  const [suggestionBusyId, setSuggestionBusyId] = useState<string | null>(null);

  // Merge mode
  const [mergeMode, setMergeMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lassoStart, setLassoStart] = useState<Point | null>(null);
  const [lassoEnd, setLassoEnd] = useState<Point | null>(null);
  const [mergeModal, setMergeModal] = useState<MergeModalState | null>(null);
  const [mergeBusy, setMergeBusy] = useState(false);
  const [addItemClusterId, setAddItemClusterId] = useState<string | null>(null);
  const [xReplyClusterId, setXReplyClusterId] = useState<string | null>(null);
  const [xReplyThreadUrl, setXReplyThreadUrl] = useState<string>("");
  const [xReplyEntityId, setXReplyEntityId] = useState<string | null>(null);
  const [igCommentClusterId, setIgCommentClusterId] = useState<string | null>(null);
  const [igCommentPostUrl, setIgCommentPostUrl] = useState<string>("");
  const [igCommentEntityId, setIgCommentEntityId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Report modal
  const [reportModalClusterId, setReportModalClusterId] = useState<string | null>(null);
  const [reportModalClusters, setReportModalClusters] = useState<Array<{ id: string; label: string | null; itemCount: number }>>([]);
  const [reportModalSelectedIds, setReportModalSelectedIds] = useState<Set<string>>(new Set());
  const [reportModalLoading, setReportModalLoading] = useState(false);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const gridRef = useRef<HTMLDivElement>(null);

  const fetchClusters = useCallback(async () => {
    if (!activeCompanyId) return;
    setLoading(true);
    const params = new URLSearchParams({ sort, hideSingletons: String(hideSingletons), companyId: activeCompanyId });
    if (entityId !== "all") params.set("entityId", entityId);
    const res = await fetch(`/api/clusters?${params}`);
    const data = await res.json();
    setClusterList(data.clusters ?? []);
    setStats(data.stats ?? null);
    setLoading(false);
  }, [entityId, sort, hideSingletons, activeCompanyId]);

  const fetchSuggestions = useCallback(async () => {
    if (!activeCompanyId) return;
    try {
      const res = await fetch(`/api/merge-suggestions?companyId=${activeCompanyId}`);
      const data = await res.json();
      setSuggestions(data.suggestions ?? []);
    } catch {
      setSuggestions([]);
    }
  }, [activeCompanyId]);

  useEffect(() => {
    if (activeCompanyId) fetch(`/api/entities?companyId=${activeCompanyId}`).then((r) => r.json()).then(setEntities);
  }, [activeCompanyId]);
  useEffect(() => { fetchClusters(); }, [fetchClusters]);
  useEffect(() => { fetchSuggestions(); }, [fetchSuggestions]);

  const acceptSuggestion = async (s: MergeSuggestion) => {
    setSuggestionBusyId(s.id);
    try {
      const classSet = [...new Set(s.clusters.map((c) => c.effectiveClassification))];
      const classification = classSet.length === 1 ? classSet[0] : "unclassified";
      await fetch("/api/clusters/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clusterIds: s.clusters.map((c) => c.id),
          label: s.suggestedLabel ?? s.clusters.find((c) => c.label)?.label ?? null,
          classification,
        }),
      });
      await fetch(`/api/merge-suggestions/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "accepted" }),
      });
      setSuggestions((prev) => prev.filter((x) => x.id !== s.id));
      fetchClusters();
    } catch (err) {
      console.error("[merge-suggestion accept]", err);
    } finally {
      setSuggestionBusyId(null);
    }
  };

  const dismissSuggestion = async (s: MergeSuggestion) => {
    setSuggestionBusyId(s.id);
    try {
      await fetch(`/api/merge-suggestions/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "dismissed" }),
      });
      setSuggestions((prev) => prev.filter((x) => x.id !== s.id));
    } finally {
      setSuggestionBusyId(null);
    }
  };

  // ── Lasso: global mousemove/mouseup listeners while dragging ────────────────
  useEffect(() => {
    if (!lassoStart) return;
    const onMove = (e: MouseEvent) => setLassoEnd({ x: e.clientX, y: e.clientY });
    const onUp = (e: MouseEvent) => {
      const end = { x: e.clientX, y: e.clientY };
      const delta = Math.abs(end.x - lassoStart.x) + Math.abs(end.y - lassoStart.y);
      if (delta < 5) {
        // Click — toggle the card under the cursor
        for (const [id, el] of cardRefs.current.entries()) {
          const r = el.getBoundingClientRect();
          if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
            setSelectedIds((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
            break;
          }
        }
      } else {
        // Lasso — find all cards that intersect the rect
        const selLeft = Math.min(lassoStart.x, end.x);
        const selTop = Math.min(lassoStart.y, end.y);
        const selRight = Math.max(lassoStart.x, end.x);
        const selBottom = Math.max(lassoStart.y, end.y);
        const intersecting = new Set<string>();
        for (const [id, el] of cardRefs.current.entries()) {
          const r = el.getBoundingClientRect();
          if (r.left < selRight && r.right > selLeft && r.top < selBottom && r.bottom > selTop) intersecting.add(id);
        }
        setSelectedIds(intersecting);
      }
      setLassoStart(null);
      setLassoEnd(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [lassoStart]);

  const handleGridMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!mergeMode) return;
    if ((e.target as HTMLElement).closest("button, a, select, input")) return;
    e.preventDefault();
    setLassoStart({ x: e.clientX, y: e.clientY });
    setLassoEnd({ x: e.clientX, y: e.clientY });
  }, [mergeMode]);

  const toggleMergeMode = () => {
    setMergeMode((v) => !v);
    setSelectedIds(new Set());
    setLassoStart(null);
    setLassoEnd(null);
  };

  const openMergeModal = () => {
    const selected = clusterList.filter((c) => selectedIds.has(c.id));
    const bySize = [...selected].sort((a, b) => b.itemCount - a.itemCount);
    const defaultLabel = bySize.find((c) => c.label)?.label ?? "";
    const classSet = [...new Set(selected.map((c) => c.effectiveClassification))];
    const hasConflict = classSet.length > 1;
    setMergeModal({ selected, label: defaultLabel, classification: hasConflict ? null : (classSet[0] ?? null), hasConflict });
  };

  const confirmMerge = async () => {
    if (!mergeModal?.classification) return;
    setMergeBusy(true);
    try {
      await fetch("/api/clusters/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clusterIds: [...selectedIds], label: mergeModal.label || null, classification: mergeModal.classification }),
      });
      setMergeModal(null);
      setMergeMode(false);
      setSelectedIds(new Set());
      fetchClusters();
    } catch (err) {
      console.error("[merge]", err);
    } finally {
      setMergeBusy(false);
    }
  };

  const openReportModal = useCallback(async (clusterId: string, entityId: string | null) => {
    setReportModalClusterId(clusterId);
    setReportModalSelectedIds(new Set());
    setReportModalLoading(true);
    try {
      const params = new URLSearchParams();
      if (entityId) params.set("entityId", entityId);
      const res = await fetch(`/api/clusters?${params}`);
      const data = await res.json();
      setReportModalClusters(
        (data.clusters as Array<{ id: string; label: string | null; itemCount: number }>)
          .filter((c) => c.id !== clusterId)
      );
    } finally {
      setReportModalLoading(false);
    }
  }, []);

  const generateReport = useCallback(async (clusterId: string, linkedIds: Set<string>) => {
    setReportingId(clusterId);
    setReportModalClusterId(null);
    try {
      const res = await fetch(`/api/clusters/${clusterId}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkedClusterIds: [...linkedIds] }),
      });
      const { reportId } = await res.json();
      router.push(`/analyst/report/${reportId}`);
    } catch {
      setReportingId(null);
    }
  }, [router]);

  const analyzeSentiment = useCallback(async (clusterId: string) => {
    setAnalyzingSentimentId(clusterId);
    try {
      const res = await fetch(`/api/clusters/${clusterId}/sentiment`, { method: "POST" });
      if (res.ok) {
        const { sentimentLabel, sentimentScore } = await res.json();
        setClusterList((prev) =>
          prev.map((c) => c.id === clusterId ? { ...c, sentimentLabel, sentimentScore } : c)
        );
      }
    } finally {
      setAnalyzingSentimentId(null);
    }
  }, []);

  const runCluster = useCallback(async () => {
    setClusterRunning(true); setClusterResult(null);
    try {
      const res = await fetch("/api/run/cluster", { method: "POST" });
      const data = await res.json();
      setClusterResult(data.assigned === 0 && data.created === 0 ? "nothing to cluster" : `${data.assigned} assigned · ${data.created} new clusters`);
      fetchClusters();
    } catch { setClusterResult("error — check console"); }
    finally { setClusterRunning(false); }
  }, [fetchClusters]);

  const deleteCluster = async (clusterId: string) => {
    setDeleteBusy(true);
    try {
      await fetch(`/api/clusters/${clusterId}/delete`, { method: "DELETE" });
      setClusterList((prev) => prev.filter((c) => c.id !== clusterId));
      setDeleteConfirmId(null);
    } finally {
      setDeleteBusy(false);
    }
  };

  const toggleExpand = useCallback(async (clusterId: string) => {
    if (expandedIds.has(clusterId)) {
      setExpandedIds((prev) => { const s = new Set(prev); s.delete(clusterId); return s; });
      return;
    }
    if (!expandedData[clusterId]) {
      setExpandLoading((prev) => new Set(prev).add(clusterId));
      const res = await fetch(`/api/clusters/${clusterId}/items`);
      const data: ExpandedData = await res.json();
      setExpandedData((prev) => ({ ...prev, [clusterId]: data }));
      setExpandLoading((prev) => { const s = new Set(prev); s.delete(clusterId); return s; });
    }
    setExpandedIds((prev) => new Set(prev).add(clusterId));
  }, [expandedIds, expandedData]);

  const toggleSummary = (id: string) =>
    setSummaryExpanded((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  const saveLabel = async (clusterId: string, label: string) => {
    setSavingLabel(true);
    await fetch(`/api/clusters/${clusterId}/label`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: label.trim() || null }),
    });
    setClusterList((prev) => prev.map((c) => c.id === clusterId ? { ...c, label: label.trim() || null } : c));
    setSavingLabel(false);
    setEditingLabelId(null);
  };

  const savePeriodNarrative = async (clusterId: string, date: string, narrative: string) => {
    setSavingPeriod(true);
    await fetch(`/api/clusters/${clusterId}/period-narrative`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, narrative }),
    });
    setExpandedData((prev) => {
      const d = prev[clusterId];
      if (!d) return prev;
      return { ...prev, [clusterId]: { ...d, periodNarratives: { ...d.periodNarratives, [date]: { ...(d.periodNarratives[date] ?? { aiNarrative: null }), analystNarrative: narrative } } } };
    });
    setSavingPeriod(false);
    setEditingPeriod(null);
  };

  // ── Render date-grouped expanded items ──────────────────────────────────────
  function renderExpandedItems(cluster: Cluster) {
    const data = expandedData[cluster.id];
    if (!data) return null;
    const { items, periodNarratives } = data;

    const byDay = new Map<string, ClusterItem[]>();
    for (const item of items) {
      const day = item.ingestedAt.slice(0, 10);
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day)!.push(item);
    }
    // Descending: most recent day first; items within each day also newest first
    const dayGroups = [...byDay.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([day, dayItems]) => [day, [...dayItems].sort((a, b) => b.ingestedAt.localeCompare(a.ingestedAt))] as [string, ClusterItem[]]);
    const multiDay = dayGroups.length > 1;

    return (
      <div className="cluster-card-items">
        {(data.newsLinks?.length ?? 0) > 0 && <RelatedNewsBlock links={data.newsLinks!} />}
        {dayGroups.map(([day, dayItems], gi) => {
          const pn = periodNarratives[day];
          const periodText = pn?.analystNarrative ?? pn?.aiNarrative ?? null;
          const isEditingThis = editingPeriod?.clusterId === cluster.id && editingPeriod.date === day;
          return (
            <div key={day}>
              {multiDay && <WaveHeader label={shortDate(day + "T12:00:00Z")} isFirst={gi === 0} />}
              {isEditingThis ? (
                <div style={{ display: "flex", gap: 6, alignItems: "flex-start", marginBottom: 6, padding: "4px 0" }}>
                  <textarea
                    autoFocus
                    value={editingPeriodDraft}
                    onChange={(e) => setEditingPeriodDraft(e.target.value)}
                    rows={2}
                    style={{ flex: 1, fontSize: 12, fontFamily: "inherit", color: "var(--ink-60)", background: "var(--paper)", border: "1px solid var(--accent)", borderRadius: 4, padding: "4px 6px", resize: "vertical" }}
                  />
                  <button className="btn" style={{ fontSize: 11, padding: "3px 8px" }} disabled={savingPeriod} onClick={() => savePeriodNarrative(cluster.id, day, editingPeriodDraft)}>{savingPeriod ? "…" : "Save"}</button>
                  <button className="btn-ghost btn" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => setEditingPeriod(null)}>Cancel</button>
                </div>
              ) : (
                <div
                  style={{ fontSize: 12, color: "var(--ink-50)", lineHeight: 1.5, marginBottom: 4, padding: "3px 0", cursor: "pointer", fontStyle: periodText ? "normal" : "italic" }}
                  title="Click to edit period note"
                  onClick={() => { setEditingPeriod({ clusterId: cluster.id, date: day }); setEditingPeriodDraft(periodText ?? ""); }}
                >
                  {periodText ?? <span style={{ opacity: 0.4 }}>Add note…</span>}
                </div>
              )}
              {dayItems.map((item, i) => renderItemRow(item, i, cluster.id))}
            </div>
          );
        })}
        <div style={{ paddingTop: 6, display: "flex", justifyContent: "flex-end" }}>
          <button
            className="btn btn-ghost"
            style={{ fontSize: 11, fontFamily: "var(--font-mono)", letterSpacing: "0.05em" }}
            onClick={() => setAddItemClusterId(cluster.id)}
          >
            + Add item
          </button>
        </div>
      </div>
    );
  }

  function renderItemRow(item: ClusterItem, i: number, clusterId: string) {
    const href = item.platform === "hackernews" && item.externalId
      ? `https://news.ycombinator.com/item?id=${item.externalId}`
      : item.url;
    return (
      <div key={i} className="cluster-item-row">
        <PlatformChip platform={item.platform} size="sm" />
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
          clusterId={clusterId}
          itemId={item.itemId}
          note={item.analystNote}
          flag={item.analystFlag as "review" | "highlight" | null}
          onUpdate={(note, flag) => {
            setExpandedData((prev) => {
              const d = prev[clusterId];
              if (!d) return prev;
              return { ...prev, [clusterId]: { ...d, items: d.items.map((it) => it.itemId === item.itemId ? { ...it, analystNote: note, analystFlag: flag } : it) } };
            });
          }}
        />
      </div>
    );
  }

  const latestCluster = clusterList[0];
  const lassoRect = lassoStart && lassoEnd ? {
    left: Math.min(lassoStart.x, lassoEnd.x),
    top: Math.min(lassoStart.y, lassoEnd.y),
    width: Math.abs(lassoEnd.x - lassoStart.x),
    height: Math.abs(lassoEnd.y - lassoStart.y),
  } : null;

  return (
    <>
      {/* Lasso selection rect */}
      {lassoRect && lassoRect.width > 2 && lassoRect.height > 2 && (
        <div style={{ position: "fixed", zIndex: 9999, pointerEvents: "none", left: lassoRect.left, top: lassoRect.top, width: lassoRect.width, height: lassoRect.height, border: "1.5px dashed var(--accent)", background: "color-mix(in oklch, var(--accent) 8%, transparent)", borderRadius: 3 }} />
      )}

      {/* Report — linked cluster selection modal */}
      {reportModalClusterId && (
        <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setReportModalClusterId(null)}>
          <div style={{ background: "var(--paper)", border: "1px solid var(--border)", borderRadius: 8, boxShadow: "0 8px 32px rgba(0,0,0,0.18)", width: 480, maxWidth: "90vw", maxHeight: "80vh", display: "flex", flexDirection: "column" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ padding: "20px 24px 0" }}>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Link clusters to this brief</div>
              <p style={{ fontSize: 13, color: "var(--ink-60)", margin: "0 0 16px", lineHeight: 1.5 }}>
                Select other clusters to include in the analysis. Their items and notes will be sent to the AI alongside this cluster.
              </p>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "0 24px" }}>
              {reportModalLoading ? (
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-40)", padding: "12px 0" }}>Loading clusters…</div>
              ) : reportModalClusters.length === 0 ? (
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-40)", fontStyle: "italic", padding: "12px 0" }}>No other clusters for this entity.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {reportModalClusters.map((c) => {
                    const checked = reportModalSelectedIds.has(c.id);
                    return (
                      <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 6, cursor: "pointer", background: checked ? "color-mix(in oklch, var(--accent) 8%, var(--paper))" : "transparent", border: `1px solid ${checked ? "color-mix(in oklch, var(--accent) 30%, transparent)" : "transparent"}` }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            setReportModalSelectedIds((prev) => {
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
                {reportModalSelectedIds.size > 0 ? `${reportModalSelectedIds.size} cluster${reportModalSelectedIds.size !== 1 ? "s" : ""} linked` : "No additional clusters selected"}
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn-ghost btn" style={{ fontSize: 12 }} onClick={() => setReportModalClusterId(null)}>Cancel</button>
                <button
                  className="btn"
                  style={{ fontSize: 12 }}
                  disabled={reportingId === reportModalClusterId}
                  onClick={() => generateReport(reportModalClusterId, reportModalSelectedIds)}
                >
                  {reportingId === reportModalClusterId ? "Generating…" : "Generate Brief"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Merge confirmation modal */}
      {mergeModal && (
        <MergeModal
          state={mergeModal}
          onChange={(patch) => setMergeModal((prev) => prev ? { ...prev, ...patch } : null)}
          onConfirm={confirmMerge}
          onCancel={() => setMergeModal(null)}
          busy={mergeBusy}
        />
      )}

      {deleteConfirmId && (() => {
        const cluster = clusterList.find((c) => c.id === deleteConfirmId);
        return (
          <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ background: "var(--paper)", border: "1px solid var(--border)", borderRadius: 8, boxShadow: "0 8px 32px rgba(0,0,0,0.18)", width: 400, maxWidth: "90vw", padding: 24 }}>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Delete cluster?</div>
              <p style={{ fontSize: 13, color: "var(--ink-60)", marginBottom: 20, lineHeight: 1.5 }}>
                <strong>{cluster?.label ?? "Unnamed cluster"}</strong> and all its ingested items will be permanently deleted. This cannot be undone.
              </p>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button className="btn-ghost btn" onClick={() => setDeleteConfirmId(null)} disabled={deleteBusy}>Cancel</button>
                <button
                  className="btn"
                  style={{ background: "var(--err)", color: "#fff", borderColor: "var(--err)" }}
                  onClick={() => deleteCluster(deleteConfirmId)}
                  disabled={deleteBusy}
                >
                  {deleteBusy ? "Deleting…" : "Delete cluster"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {addItemClusterId && (
        <AddItemDialog
          clusterId={addItemClusterId}
          clusterEntityId={clusterList.find((c) => c.id === addItemClusterId)?.entityId ?? null}
          onAdded={async () => {
            const res = await fetch(`/api/clusters/${addItemClusterId}/items`);
            const data = await res.json();
            setExpandedData((prev) => ({ ...prev, [addItemClusterId!]: data }));
            fetchClusters();
          }}
          onClose={() => setAddItemClusterId(null)}
        />
      )}

      <header className="topbar">
        <div>
          <div className="eyebrow">Part 2 · Clusters</div>
          <h1 className="page-title">Clusters</h1>
          <p className="page-desc">Topics grouped by semantic similarity. Classify to surface narratives.</p>
        </div>
        <div className="topbar-actions">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button className="btn-ghost btn" onClick={() => setThreadDialogOpen(true)}>+ Ingest thread</button>
            <button className="btn-ghost btn" onClick={toggleMergeMode} style={mergeMode ? { borderColor: "var(--accent)", color: "var(--accent)" } : {}}>
              {mergeMode ? "Exit Merge Mode" : "Select to Merge"}
            </button>
            <button className="btn-ghost btn" onClick={runCluster} disabled={clusterRunning}>{clusterRunning ? "Clustering…" : "Run Cluster"}</button>
            {clusterResult && (
              <span style={{ fontSize: 12, color: "var(--ink-40)", whiteSpace: "nowrap" }}>{clusterResult}</span>
            )}
          </div>
        </div>
      </header>

      <div className="page">
        <div className="kpi-row">
          <div className="kpi">
            <div className="kpi-top"><div className="kpi-label">Active clusters</div></div>
            <div className="kpi-mid"><div className="kpi-value">{stats?.total ?? "—"}</div><div className="kpi-delta kpi-delta-flat">→ topics found</div></div>
          </div>
          <div className="kpi">
            <div className="kpi-top"><div className="kpi-label">Items clustered</div></div>
            <div className="kpi-mid"><div className="kpi-value">{stats?.itemsClustered ?? "—"}</div><div className="kpi-delta kpi-delta-flat">→ of {stats?.totalItems ?? "—"} total</div></div>
          </div>
          <div className="kpi">
            <div className="kpi-top"><div className="kpi-label">Avg cluster size</div></div>
            <div className="kpi-mid"><div className="kpi-value">{stats?.avgSize ?? "—"}</div><div className="kpi-delta kpi-delta-flat">→ items / topic</div></div>
          </div>
          <div className="kpi">
            <div className="kpi-top"><div className="kpi-label">Latest activity</div></div>
            <div className="kpi-mid">
              <div className="kpi-value" style={{ fontSize: 15, fontWeight: 500, marginTop: 6, lineHeight: 1.3 }}>{latestCluster?.label ?? (latestCluster ? "Unnamed" : "—")}</div>
              <div className={cx("kpi-delta", latestCluster ? "kpi-delta-up" : "kpi-delta-flat")}>{latestCluster ? `▲ ${relativeTime(latestCluster.lastSeenAt)}` : "no clusters yet"}</div>
            </div>
          </div>
        </div>

        {mergeMode && (
          <div style={{ padding: "8px 12px", background: "color-mix(in oklch, var(--accent) 8%, var(--paper))", border: "1px solid color-mix(in oklch, var(--accent) 30%, transparent)", borderRadius: 6, fontSize: 13, color: "var(--ink-60)", marginBottom: 8 }}>
            <strong style={{ color: "var(--accent)" }}>Merge mode:</strong> click a card to select it, or drag to lasso-select multiple clusters.
          </div>
        )}

        {suggestions.length > 0 && (
          <div style={{ padding: "10px 12px", background: "color-mix(in oklch, var(--accent) 6%, var(--paper))", border: "1px solid color-mix(in oklch, var(--accent) 25%, transparent)", borderRadius: 6, marginBottom: 8 }}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--accent)", marginBottom: 8 }}>
              Suggested merges · {suggestions.length}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {suggestions.slice(0, 5).map((s) => (
                <div key={s.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, lineHeight: 1.4 }}>
                      {s.clusters.map((c, i) => (
                        <span key={c.id}>
                          {i > 0 && <span style={{ color: "var(--ink-30)", margin: "0 5px" }}>+</span>}
                          {c.label ?? "Unnamed"}
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--ink-40)" }}> ({c.itemCount})</span>
                        </span>
                      ))}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--ink-50)", marginTop: 1 }}>
                      {s.reason}
                      {s.confidence != null && (
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--ink-40)" }}> · {Math.round(s.confidence * 100)}%</span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <button
                      className="btn"
                      style={{ fontSize: 11, padding: "3px 10px" }}
                      disabled={suggestionBusyId === s.id}
                      onClick={() => acceptSuggestion(s)}
                    >
                      {suggestionBusyId === s.id ? "Merging…" : "Merge"}
                    </button>
                    <button
                      className="btn-ghost btn"
                      style={{ fontSize: 11, padding: "3px 10px" }}
                      disabled={suggestionBusyId === s.id}
                      onClick={() => dismissSuggestion(s)}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              ))}
              {suggestions.length > 5 && (
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-40)" }}>
                  + {suggestions.length - 5} more pending
                </div>
              )}
            </div>
          </div>
        )}

        <StageKey />

        <div className="toolbar" style={{ flexWrap: "wrap", gap: 8 }}>
          <div className="filter-group">
            <span className="filter-label">Entity</span>
            <select className="select" value={entityId} onChange={(e) => setEntityId(e.target.value)}>
              <option value="all">All entities</option>
              {entities.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
            </select>
          </div>
          <div className="filter-group">
            <span className="filter-label">Sort</span>
            <select className="select" value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="activity">Latest activity</option>
              <option value="momentum">Momentum</option>
              <option value="size">Largest</option>
              <option value="created">Newest</option>
            </select>
          </div>
          <div className="filter-group" style={{ marginLeft: "auto" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
              <input type="checkbox" checked={hideSingletons} onChange={(e) => setHideSingletons(e.target.checked)} />
              Hide singletons
            </label>
          </div>
        </div>

        {loading ? (
          <div className="empty"><div className="empty-mark">⧖</div><div className="empty-title">Loading clusters…</div></div>
        ) : clusterList.length === 0 ? (
          <div className="empty"><div className="empty-mark">◎</div><div className="empty-title">No clusters match filters</div><div className="empty-sub">Run cluster then classify to group and label topics.</div></div>
        ) : (
          <div
            className="cluster-grid"
            ref={gridRef}
            onMouseDown={handleGridMouseDown}
            style={{ cursor: mergeMode ? "crosshair" : undefined, userSelect: mergeMode ? "none" : undefined }}
          >
            {clusterList.map((cluster) => {
              const isSelected = selectedIds.has(cluster.id);
              const isExpanded = expandedIds.has(cluster.id);
              const displayItems = isExpanded ? (expandedData[cluster.id]?.items ?? cluster.topItems) : cluster.topItems;

              return (
                <div
                  key={cluster.id}
                  className="cluster-card"
                  ref={(el) => { if (el) cardRefs.current.set(cluster.id, el); else cardRefs.current.delete(cluster.id); }}
                  style={isSelected ? { outline: "2px solid var(--accent)", outlineOffset: 2 } : undefined}
                >
                  {/* Header */}
                  <div className="cluster-card-head" style={{ alignItems: "flex-start", gap: 6 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
                        <ClassificationPill classification={cluster.effectiveClassification} />
                        {cluster.sentimentLabel && <SentimentPill label={cluster.sentimentLabel} />}
                        {cluster.momentum != null && cluster.momentum > 0 && (
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-40)" }}>↑{cluster.momentum.toFixed(1)}/day</span>
                        )}
                      </div>
                      {editingLabelId === cluster.id ? (
                        <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 2 }}>
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
                        <span
                          className="cluster-card-label"
                          style={{ cursor: "text" }}
                          title="Click to edit name"
                          onClick={() => { setEditingLabelId(cluster.id); setEditingLabelDraft(cluster.label ?? ""); }}
                        >
                          {cluster.label ?? <span style={{ color: "var(--ink-40)", fontWeight: 400, fontStyle: "italic" }}>Unnamed cluster</span>}
                        </span>
                      )}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
                      {cluster.narrativeStage && cluster.itemCount >= 2 && (
                        <VelocitySparkline clusterId={cluster.id} stage={cluster.narrativeStage} firstSeenAt={cluster.firstSeenAt} />
                      )}
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span className="cluster-card-count">{cluster.itemCount} items</span>
                        {cluster.newsLinkCount > 0 && (
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-40)" }} title="Related news articles linked to this cluster">
                            ▤ {cluster.newsLinkCount} news
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="cluster-card-meta">{shortDate(cluster.firstSeenAt)} → {relativeTime(cluster.lastSeenAt)}</div>

                  {/* Narrative summary */}
                  {cluster.narrativeSummary && cluster.effectiveClassification === "narrative" && (
                    <div style={{ marginBottom: 8 }}>
                      <button onClick={() => toggleSummary(cluster.id)} style={{ background: "none", border: "none", cursor: "pointer", padding: "3px 0", fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--ink-40)", textTransform: "uppercase", letterSpacing: "0.06em", display: "flex", alignItems: "center", gap: 4 }}>
                        {summaryExpanded.has(cluster.id) ? "▾" : "▸"} Summary
                      </button>
                      {summaryExpanded.has(cluster.id) && (
                        <p style={{ fontSize: 12, color: "var(--ink-60)", lineHeight: 1.5, margin: "4px 0 0", padding: "6px 8px", background: "color-mix(in oklch, var(--accent) 6%, var(--paper))", borderLeft: "2px solid var(--accent)", borderRadius: "0 4px 4px 0" }}>
                          {cluster.narrativeSummary}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Items */}
                  {isExpanded
                    ? renderExpandedItems(cluster)
                    : displayItems.length > 0 && (
                      <div className="cluster-card-items">
                        {displayItems.map((item, i) => renderItemRow(item, i, cluster.id))}
                      </div>
                    )
                  }

                  <div className="cluster-card-foot">
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-40)" }}>sources</span>
                      {cluster.platforms.map((p) => <PlatformChip key={p} platform={p} size="sm" />)}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {cluster.itemCount > 3 && (
                        <button className="cluster-card-more" onClick={() => toggleExpand(cluster.id)}>
                          {expandLoading.has(cluster.id) ? "loading…" : isExpanded ? "show less" : `+ ${cluster.itemCount - 3} more`}
                        </button>
                      )}
                      {!mergeMode && (
                        <button
                          className="btn-ghost btn"
                          style={{ fontSize: 10, padding: "2px 8px", fontFamily: "var(--font-mono)", letterSpacing: "0.04em" }}
                          onClick={() => router.push(`/analyst/clusters/${cluster.id}`)}
                          title="Open cluster detail page"
                        >
                          ↗ Open
                        </button>
                      )}
                      <button
                        className="btn-ghost btn"
                        style={{ fontSize: 10, padding: "2px 8px", fontFamily: "var(--font-mono)", letterSpacing: "0.04em" }}
                        onClick={() => analyzeSentiment(cluster.id)}
                        disabled={analyzingSentimentId === cluster.id}
                        title="Re-analyze sentiment from all articles and notes"
                      >
                        {analyzingSentimentId === cluster.id ? "Analyzing…" : "◎ Sentiment"}
                      </button>
                      <button
                        className="btn-ghost btn"
                        style={{ fontSize: 10, padding: "2px 8px", fontFamily: "var(--font-mono)", letterSpacing: "0.04em" }}
                        onClick={() => openReportModal(cluster.id, cluster.entityId)}
                        disabled={reportingId === cluster.id}
                        title="Generate Signal Brief for this cluster"
                      >
                        {reportingId === cluster.id ? "Generating…" : "◉ Report"}
                      </button>
                      <button
                        className="btn-ghost btn"
                        style={{ fontSize: 10, padding: "2px 8px", fontFamily: "var(--font-mono)", letterSpacing: "0.04em", color: "var(--err)", borderColor: "color-mix(in oklch, var(--err) 30%, transparent)" }}
                        onClick={() => setDeleteConfirmId(cluster.id)}
                        title="Delete this cluster and all its items"
                      >
                        ✕ Delete
                      </button>
                      {(() => {
                        const isXUrl = (u: string | null) => /^https?:\/\/(x\.com|twitter\.com)\//i.test(u ?? "");
                        const xItem = cluster.topItems.find((i) =>
                          i.platform === "twitter" ||
                          (i.platform === "manual" && isXUrl(i.url))
                        );
                        if (!xItem) return null;
                        return (
                          <button
                            className="btn-ghost btn"
                            style={{ fontSize: 10, padding: "2px 8px", fontFamily: "var(--font-mono)", letterSpacing: "0.04em" }}
                            onClick={() => {
                              setXReplyClusterId(cluster.id);
                              setXReplyThreadUrl(xItem.url ?? xItem.externalId ?? "");
                              setXReplyEntityId(cluster.entityId);
                            }}
                            title="Add X replies to this cluster"
                          >
                            ↩ Replies
                          </button>
                        );
                      })()}
                      {(() => {
                        const igItem = cluster.topItems.find((i) => i.platform === "instagram");
                        if (!igItem) return null;
                        return (
                          <button
                            className="btn-ghost btn"
                            style={{ fontSize: 10, padding: "2px 8px", fontFamily: "var(--font-mono)", letterSpacing: "0.04em" }}
                            onClick={() => {
                              setIgCommentClusterId(cluster.id);
                              setIgCommentPostUrl(igItem.url ?? igItem.externalId ?? "");
                              setIgCommentEntityId(cluster.entityId);
                            }}
                            title="Add Instagram comments to this cluster"
                          >
                            ↩ Comments
                          </button>
                        );
                      })()}
                    </div>
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
                  {cluster.suggestedKeywords && cluster.suggestedKeywords.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6, paddingTop: 6, borderTop: "1px solid var(--ink-10)", alignItems: "center" }}>
                      <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-30)", marginRight: 2 }}>suggested</span>
                      {cluster.suggestedKeywords.map((kw) => (
                        <span key={kw} style={{ fontSize: 10, fontFamily: "var(--font-mono)", padding: "2px 8px", borderRadius: 99, background: "color-mix(in oklch, var(--warn) 8%, var(--paper))", color: "color-mix(in oklch, var(--warn) 70%, var(--ink))", border: "1px solid color-mix(in oklch, var(--warn) 25%, transparent)", whiteSpace: "nowrap" }}>
                          {kw}
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

      {threadDialogOpen && activeCompanyId && (
        <ThreadIngestDialog
          companyId={activeCompanyId}
          entities={entities}
          onClose={() => setThreadDialogOpen(false)}
          onInserted={() => { setThreadDialogOpen(false); fetchClusters(); }}
        />
      )}

      {xReplyClusterId && (
        <XReplyIngestDialog
          clusterId={xReplyClusterId}
          threadUrl={xReplyThreadUrl}
          entityId={xReplyEntityId}
          onClose={() => setXReplyClusterId(null)}
          onInserted={() => { setXReplyClusterId(null); fetchClusters(); }}
        />
      )}

      {igCommentClusterId && (
        <InstagramCommentIngestDialog
          clusterId={igCommentClusterId}
          postUrl={igCommentPostUrl}
          entityId={igCommentEntityId}
          onClose={() => setIgCommentClusterId(null)}
          onInserted={() => { setIgCommentClusterId(null); fetchClusters(); }}
        />
      )}

      {/* Floating merge action bar */}
      {mergeMode && selectedIds.size >= 2 && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 150, background: "var(--ink)", color: "var(--paper)", borderRadius: 8, padding: "10px 16px", display: "flex", alignItems: "center", gap: 12, boxShadow: "0 4px 20px rgba(0,0,0,0.25)", fontSize: 14 }}>
          <span style={{ fontWeight: 500 }}>{selectedIds.size} clusters selected</span>
          <button onClick={openMergeModal} style={{ background: "var(--paper)", color: "var(--ink)", border: "none", borderRadius: 5, padding: "5px 14px", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>Merge</button>
          <button onClick={() => setSelectedIds(new Set())} style={{ background: "transparent", color: "var(--ink-40)", border: "none", fontSize: 13, cursor: "pointer" }}>Clear</button>
        </div>
      )}
    </>
  );
}
