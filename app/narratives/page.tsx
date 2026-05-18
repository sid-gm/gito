"use client";

import { useEffect, useState, useCallback } from "react";
import { cx, PlatformChip, Dot } from "@/components/primitives";
import { VelocitySparkline } from "@/components/VelocitySparkline";
import { useCompany } from "@/components/CompanyContext";
import { StagePill, StageKey } from "@/components/StagePill";

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

type PeriodNarrative = { aiNarrative: string | null; analystNarrative: string | null };

type ExpandedData = {
  items: ClusterItem[];
  merges: Record<string, MergeInfo>;
  periodNarratives: Record<string, PeriodNarrative>;
};

type Narrative = {
  id: string;
  label: string | null;
  itemCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  narrativeStage: string | null;
  narrativeSummary: string | null;
  momentum: number | null;
  peakMomentum: number | null;
  velocity24h: number | null;
  prevVelocity24h: number | null;
  platformCount: number | null;
  analystClassification: string | null;
  analystNote: string | null;
  effectiveClassification: string;
  topItems: ClusterItem[];
  platforms: string[];
  trackedEntities: Array<{ id: string; label: string }>;
};

type Entity = { id: string; label: string };

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

function SignalBadge({ signal }: { signal: string }) {
  const map: Record<string, { label: string; color: string }> = {
    signal: { label: "SIGNAL", color: "var(--ok)" },
    watch:  { label: "WATCH",  color: "var(--accent)" },
    noise:  { label: "NOISE",  color: "var(--ink-30)" },
    unclassified: { label: "—", color: "var(--ink-20)" },
  };
  const m = map[signal] ?? map.unclassified;
  return (
    <span style={{
      fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 600, letterSpacing: "0.08em",
      textTransform: "uppercase", color: m.color,
      border: `1px solid ${m.color}`, borderRadius: 2, padding: "1px 4px",
      flexShrink: 0,
    }}>
      {m.label}
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

function ItemSignalOverride({
  clusterId,
  itemId,
  current,
  onDone,
}: {
  clusterId: string;
  itemId: string;
  current: string | null;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const apply = async (val: "signal" | "noise" | "watch" | null) => {
    setBusy(true);
    await fetch(`/api/clusters/${clusterId}/items/${itemId}/signal`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signal: val }),
    });
    setBusy(false);
    onDone();
  };

  return (
    <select
      value={current ?? ""}
      disabled={busy}
      onChange={(e) => {
        const v = e.target.value;
        apply(v ? (v as "signal" | "noise" | "watch") : null);
      }}
      style={{
        fontSize: 11, fontFamily: "var(--font-mono)", border: "1px solid var(--border)",
        borderRadius: 3, padding: "1px 4px", background: "var(--paper)", color: "var(--ink-60)",
        cursor: "pointer",
      }}
    >
      <option value="">auto</option>
      <option value="signal">signal</option>
      <option value="noise">noise</option>
      <option value="watch">watch</option>
    </select>
  );
}

export default function NarrativesPage() {
  const { activeCompanyId } = useCompany();
  const [narratives, setNarratives] = useState<Narrative[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [entityId, setEntityId] = useState("all");
  const [stageFilter, setStageFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [expandedData, setExpandedData] = useState<Record<string, ExpandedData>>({});
  const [expandLoading, setExpandLoading] = useState<Set<string>>(new Set());
  const [editingPeriod, setEditingPeriod] = useState<{ clusterId: string; date: string } | null>(null);
  const [editingPeriodDraft, setEditingPeriodDraft] = useState("");
  const [savingPeriod, setSavingPeriod] = useState(false);
  const [editingNarrativeId, setEditingNarrativeId] = useState<string | null>(null);
  const [editingNarrativeDraft, setEditingNarrativeDraft] = useState("");
  const [savingNarrative, setSavingNarrative] = useState(false);
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [editingLabelDraft, setEditingLabelDraft] = useState("");
  const [savingLabel, setSavingLabel] = useState(false);

  const fetchNarratives = useCallback(async () => {
    if (!activeCompanyId) return;
    setLoading(true);
    const params = new URLSearchParams({
      classification: "narrative",
      sort: "momentum",
      hideSingletons: "true",
      stage: stageFilter,
      companyId: activeCompanyId,
    });
    if (entityId !== "all") params.set("entityId", entityId);
    const res = await fetch(`/api/clusters?${params}`);
    const data = await res.json();
    setNarratives(data.clusters ?? []);
    setLoading(false);
  }, [entityId, stageFilter, activeCompanyId]);

  useEffect(() => {
    if (activeCompanyId) fetch(`/api/entities?companyId=${activeCompanyId}`).then((r) => r.json()).then(setEntities);
  }, [activeCompanyId]);

  useEffect(() => { fetchNarratives(); }, [fetchNarratives]);

  const loadItems = useCallback(async (narrativeId: string): Promise<ExpandedData> => {
    setExpandLoading((prev) => new Set(prev).add(narrativeId));
    const res = await fetch(`/api/clusters/${narrativeId}/items`);
    const data: ExpandedData = await res.json();
    setExpandedData((prev) => ({ ...prev, [narrativeId]: data }));
    setExpandLoading((prev) => { const s = new Set(prev); s.delete(narrativeId); return s; });
    return data;
  }, []);

  const reloadItems = useCallback(async (narrativeId: string) => {
    const res = await fetch(`/api/clusters/${narrativeId}/items`);
    const data: ExpandedData = await res.json();
    setExpandedData((prev) => ({ ...prev, [narrativeId]: data }));
  }, []);

  const toggleExpand = useCallback(async (id: string) => {
    if (expandedIds.has(id)) {
      setExpandedIds((prev) => { const s = new Set(prev); s.delete(id); return s; });
    } else {
      if (!expandedData[id]) await loadItems(id);
      setExpandedIds((prev) => new Set(prev).add(id));
    }
  }, [expandedIds, expandedData, loadItems]);

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

  const saveLabel = async (narrativeId: string, label: string) => {
    setSavingLabel(true);
    await fetch(`/api/clusters/${narrativeId}/label`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: label.trim() || null }),
    });
    setNarratives((prev) => prev.map((n) => n.id === narrativeId ? { ...n, label: label.trim() || null } : n));
    setSavingLabel(false);
    setEditingLabelId(null);
  };

  const classifyNarrative = async (narrativeId: string, classification: "signal" | "watch" | "noise" | null) => {
    await fetch(`/api/clusters/${narrativeId}/classify`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classification }),
    });
    setNarratives((prev) =>
      prev.map((n) => n.id === narrativeId ? { ...n, analystClassification: classification } : n)
    );
  };

  const saveNarrative = async (clusterId: string, narrative: string) => {
    setSavingNarrative(true);
    await fetch(`/api/clusters/${clusterId}/narrative`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ narrative }),
    });
    setNarratives((prev) => prev.map((n) => n.id === clusterId ? { ...n, narrativeSummary: narrative } : n));
    setSavingNarrative(false);
    setEditingNarrativeId(null);
  };

  function renderItemRow(item: ClusterItem, i: number, narrativeId: string) {
    const effectiveSignal = item.analystSignal ?? item.itemSignal;
    const href = item.platform === "hackernews" && item.externalId
      ? `https://news.ycombinator.com/item?id=${item.externalId}`
      : item.url;
    return (
      <div key={i} className="cluster-item-row" style={{ alignItems: "flex-start", gap: 6 }}>
        <PlatformChip platform={item.platform} size="sm" />
        <span className="cluster-item-title" style={{ flex: 1 }}>
          {href ? (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {cleanTitle(item.title) ?? item.body?.slice(0, 140) ?? href}
            </a>
          ) : (
            cleanTitle(item.title) ?? item.body?.slice(0, 140) ?? "—"
          )}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          <SignalBadge signal={effectiveSignal} />
          <ItemSignalOverride
            clusterId={narrativeId}
            itemId={item.itemId}
            current={item.analystSignal}
            onDone={() => { fetchNarratives(); reloadItems(narrativeId); }}
          />
        </div>
      </div>
    );
  }

  function renderExpandedItems(narrative: Narrative) {
    const data = expandedData[narrative.id];
    if (!data) return null;
    const { items, periodNarratives } = data;

    const byDay = new Map<string, ClusterItem[]>();
    for (const item of items) {
      const day = item.ingestedAt.slice(0, 10);
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day)!.push(item);
    }
    const dayGroups = [...byDay.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([day, dayItems]) => [day, [...dayItems].sort((a, b) => b.ingestedAt.localeCompare(a.ingestedAt))] as [string, ClusterItem[]]);
    const multiDay = dayGroups.length > 1;

    return (
      <div className="cluster-card-items">
        {dayGroups.map(([day, dayItems], gi) => {
          const pn = periodNarratives[day];
          const periodText = pn?.analystNarrative ?? pn?.aiNarrative ?? null;
          const isEditingThis = editingPeriod?.clusterId === narrative.id && editingPeriod.date === day;
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
                  <button className="btn" style={{ fontSize: 11, padding: "3px 8px" }} disabled={savingPeriod} onClick={() => savePeriodNarrative(narrative.id, day, editingPeriodDraft)}>{savingPeriod ? "…" : "Save"}</button>
                  <button className="btn-ghost btn" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => setEditingPeriod(null)}>Cancel</button>
                </div>
              ) : (
                <div
                  style={{ fontSize: 12, color: "var(--ink-50)", lineHeight: 1.5, marginBottom: 4, padding: "3px 0", cursor: "pointer", fontStyle: periodText ? "normal" : "italic" }}
                  title="Click to edit period note"
                  onClick={() => { setEditingPeriod({ clusterId: narrative.id, date: day }); setEditingPeriodDraft(periodText ?? ""); }}
                >
                  {periodText ?? <span style={{ opacity: 0.4 }}>Add note…</span>}
                </div>
              )}
              {dayItems.map((item, i) => renderItemRow(item, i, narrative.id))}
            </div>
          );
        })}
      </div>
    );
  }

  const activeNarratives = narratives.filter((n) =>
    n.narrativeStage === "emerging" || n.narrativeStage === "developing" || n.narrativeStage === "revival"
  ).length;

  return (
    <>
      <header className="topbar">
        <div>
          <div className="eyebrow">Part 3 · Narratives</div>
          <h1 className="page-title">Narratives</h1>
          <p className="page-desc">Developing stories classified from your clusters. Track signal and noise within each.</p>
        </div>
      </header>

      <div className="page">
        <div className="kpi-row">
          <div className="kpi">
            <div className="kpi-top"><div className="kpi-label">Active narratives</div></div>
            <div className="kpi-mid">
              <div className="kpi-value">{loading ? "—" : narratives.length}</div>
              <div className="kpi-delta kpi-delta-flat">→ total classified</div>
            </div>
          </div>
          <div className="kpi">
            <div className="kpi-top"><div className="kpi-label">Developing now</div></div>
            <div className="kpi-mid">
              <div className="kpi-value">{loading ? "—" : activeNarratives}</div>
              <div className={cx("kpi-delta", activeNarratives > 0 ? "kpi-delta-up" : "kpi-delta-flat")}>
                {activeNarratives > 0 ? "▲ emerging or developing" : "→ none active"}
              </div>
            </div>
          </div>
          <div className="kpi">
            <div className="kpi-top"><div className="kpi-label">Top story</div></div>
            <div className="kpi-mid">
              <div className="kpi-value" style={{ fontSize: 14, fontWeight: 500, marginTop: 4, lineHeight: 1.3 }}>
                {narratives[0]?.label ?? "—"}
              </div>
              {narratives[0] && (
                <div className="kpi-delta kpi-delta-up">
                  ▲ {relativeTime(narratives[0].lastSeenAt)}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="toolbar">
          <div className="filter-group">
            <span className="filter-label">Entity</span>
            <select className="select" value={entityId} onChange={(e) => setEntityId(e.target.value)}>
              <option value="all">All entities</option>
              {entities.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
            </select>
          </div>
          <div className="filter-group">
            <span className="filter-label">Stage</span>
            <select className="select" value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}>
              <option value="all">All stages</option>
              <option value="emerging">Emerging</option>
              <option value="developing">Developing</option>
              <option value="revival">Revival</option>
              <option value="peaked">Peaked</option>
              <option value="declining">Declining</option>
            </select>
          </div>
        </div>

        <StageKey />

        {loading ? (
          <div className="empty"><div className="empty-mark">⧖</div><div className="empty-title">Loading narratives…</div></div>
        ) : narratives.length === 0 ? (
          <div className="empty">
            <div className="empty-mark">◎</div>
            <div className="empty-title">No narratives yet</div>
            <div className="empty-sub">Run Classify on the Clusters page to identify developing stories.</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {narratives.map((n) => {
              const isExpanded = expandedIds.has(n.id);
              const allItems = expandedData[n.id]?.items ?? n.topItems;
              const signalCount = allItems.filter((i) => (i.analystSignal ?? i.itemSignal) === "signal").length;
              const noiseCount = allItems.filter((i) => (i.analystSignal ?? i.itemSignal) === "noise").length;

              return (
                <div key={n.id} className="cluster-card" style={{ padding: 16 }}>
                  {/* Narrative header */}
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 8 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                        {n.itemCount >= 2 && n.narrativeStage && <StagePill stage={n.narrativeStage} velocity24h={n.velocity24h} prevVelocity24h={n.prevVelocity24h} peakMomentum={n.peakMomentum} firstSeenAt={n.firstSeenAt} platformCount={n.platformCount} />}
                        {n.momentum != null && n.momentum > 0 && (
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--accent)" }}>
                            ↑{n.momentum.toFixed(1)}/day
                          </span>
                        )}
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ok)" }}>
                          {signalCount} signal
                        </span>
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-30)" }}>
                          {noiseCount} noise
                        </span>
                      </div>
                      <div style={{ fontSize: 15, fontWeight: 600, color: "var(--ink-80)", lineHeight: 1.3 }}>
                        {editingLabelId === n.id ? (
                          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <input
                              autoFocus
                              value={editingLabelDraft}
                              onChange={(e) => setEditingLabelDraft(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") saveLabel(n.id, editingLabelDraft); if (e.key === "Escape") setEditingLabelId(null); }}
                              placeholder="Narrative name"
                              style={{ flex: 1, fontSize: 14, fontWeight: 600, fontFamily: "inherit", border: "1px solid var(--accent)", borderRadius: 4, padding: "2px 7px", background: "var(--paper)", color: "var(--ink-80)" }}
                            />
                            <button className="btn" style={{ fontSize: 11, padding: "2px 8px" }} disabled={savingLabel} onClick={() => saveLabel(n.id, editingLabelDraft)}>{savingLabel ? "…" : "Save"}</button>
                            <button className="btn-ghost btn" style={{ fontSize: 11, padding: "2px 8px" }} onClick={() => setEditingLabelId(null)}>Cancel</button>
                          </div>
                        ) : (
                          <span
                            style={{ cursor: "text" }}
                            title="Click to edit name"
                            onClick={() => { setEditingLabelId(n.id); setEditingLabelDraft(n.label ?? ""); }}
                          >
                            {n.label ?? (
                              <span style={{ color: "var(--ink-40)", fontWeight: 400, fontStyle: "italic" }}>Unnamed narrative</span>
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
                      {n.narrativeStage && n.itemCount >= 2 && (
                        <VelocitySparkline clusterId={n.id} stage={n.narrativeStage} firstSeenAt={n.firstSeenAt} />
                      )}
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-30)", textAlign: "right" }}>
                        {n.itemCount} items
                      </div>
                    </div>
                  </div>
                  <div className="cluster-card-meta">{shortDate(n.firstSeenAt)} → {relativeTime(n.lastSeenAt)}</div>

                  {/* Analyst classify pills */}
                  <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 8 }}>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-30)", textTransform: "uppercase", letterSpacing: "0.06em", marginRight: 2 }}>Mark:</span>
                    {(["signal", "watch", "noise"] as const).map((val) => {
                      const active = n.analystClassification === val;
                      const color = val === "signal" ? "var(--ok)" : val === "watch" ? "var(--accent)" : "var(--ink-40)";
                      return (
                        <button
                          key={val}
                          onClick={() => classifyNarrative(n.id, active ? null : val)}
                          style={{
                            fontSize: 10,
                            fontFamily: "var(--font-mono)",
                            textTransform: "uppercase",
                            letterSpacing: "0.06em",
                            padding: "2px 8px",
                            borderRadius: 99,
                            border: `1px solid ${active ? color : "var(--border)"}`,
                            background: active ? `color-mix(in oklch, ${color} 15%, var(--paper))` : "transparent",
                            color: active ? color : "var(--ink-40)",
                            cursor: "pointer",
                          }}
                        >
                          {val}
                        </button>
                      );
                    })}
                  </div>

                  {/* Narrative summary — click to edit */}
                  <div style={{ marginBottom: 10 }}>
                    {editingNarrativeId === n.id ? (
                      <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                        <textarea
                          autoFocus
                          value={editingNarrativeDraft}
                          onChange={(e) => setEditingNarrativeDraft(e.target.value)}
                          rows={3}
                          style={{ flex: 1, fontSize: 13, fontFamily: "inherit", color: "var(--ink-60)", background: "var(--paper)", border: "1px solid var(--accent)", borderRadius: 4, padding: "6px 8px", resize: "vertical" }}
                        />
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          <button className="btn" style={{ fontSize: 11, padding: "3px 10px" }} disabled={savingNarrative} onClick={() => saveNarrative(n.id, editingNarrativeDraft)}>{savingNarrative ? "…" : "Save"}</button>
                          <button className="btn-ghost btn" style={{ fontSize: 11, padding: "3px 10px" }} onClick={() => setEditingNarrativeId(null)}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <p
                        style={{ fontSize: 13, color: "var(--ink-60)", lineHeight: 1.5, margin: 0, padding: "8px 10px", background: "color-mix(in oklch, var(--accent) 6%, var(--paper))", borderLeft: "2px solid var(--accent)", borderRadius: "0 4px 4px 0", cursor: "text" }}
                        title="Click to edit"
                        onClick={() => { setEditingNarrativeId(n.id); setEditingNarrativeDraft(n.narrativeSummary ?? ""); }}
                      >
                        {n.narrativeSummary ?? <span style={{ opacity: 0.4, fontStyle: "italic" }}>No summary yet — click to add</span>}
                      </p>
                    )}
                  </div>

                  {/* Items */}
                  {isExpanded
                    ? renderExpandedItems(n)
                    : (
                      <div className="cluster-card-items">
                        {n.topItems.map((item, i) => renderItemRow(item, i, n.id))}
                      </div>
                    )
                  }

                  {/* Footer */}
                  <div className="cluster-card-foot" style={{ marginTop: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-40)" }}>Source</span>
                      {n.platforms.map((p) => <PlatformChip key={p} platform={p} size="sm" />)}
                    </div>
                    <button
                      className="cluster-card-more"
                      onClick={() => toggleExpand(n.id)}
                    >
                      {expandLoading.has(n.id)
                        ? "loading…"
                        : isExpanded
                        ? "show less"
                        : n.itemCount > 3 ? `+ ${n.itemCount - 3} more` : "show all"}
                    </button>
                  </div>
                  {n.trackedEntities?.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6, paddingTop: 6, borderTop: "1px solid var(--ink-10)" }}>
                      {n.trackedEntities.map((e) => (
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
