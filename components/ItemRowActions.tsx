"use client";

import { useEffect, useState } from "react";

type TargetCluster = { id: string; label: string | null; itemCount: number };

export function ItemRowActions({
  clusterId,
  itemId,
  entityId,
  itemTitle,
  onRemoved,
  onMoved,
}: {
  clusterId: string;
  itemId: string;
  entityId: string | null;
  itemTitle: string | null;
  onRemoved: () => void;
  onMoved: (targetClusterId: string) => void;
}) {
  const [removeOpen, setRemoveOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Move dialog state
  const [targets, setTargets] = useState<TargetCluster[] | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (!moveOpen || targets !== null) return;
    const q = entityId ? `?entityId=${entityId}` : "";
    fetch(`/api/clusters${q}`)
      .then((r) => r.json())
      .then(({ clusters }: { clusters: TargetCluster[] }) =>
        setTargets(clusters.filter((c) => c.id !== clusterId))
      )
      .catch(() => setTargets([]));
  }, [moveOpen, targets, entityId, clusterId]);

  const remove = async (deleteItem: boolean) => {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/clusters/${clusterId}/items/${itemId}${deleteItem ? "?deleteItem=true" : ""}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        setRemoveOpen(false);
        onRemoved();
      }
    } finally {
      setBusy(false);
    }
  };

  const move = async () => {
    if (!targetId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/clusters/${clusterId}/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetClusterId: targetId }),
      });
      if (res.ok) {
        setMoveOpen(false);
        onMoved(targetId);
      }
    } finally {
      setBusy(false);
    }
  };

  const filteredTargets = (targets ?? []).filter((c) =>
    (c.label ?? "").toLowerCase().includes(filter.trim().toLowerCase())
  );

  const titleSnippet = itemTitle ? `“${itemTitle.slice(0, 80)}${itemTitle.length > 80 ? "…" : ""}”` : "This item";

  return (
    <>
      <div className="item-annotation-icons">
        {/* Move to another cluster */}
        <button
          className="annotation-btn"
          onClick={() => { setMoveOpen(true); setTargetId(null); setFilter(""); }}
          title="Move to another cluster"
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 3l3 3-3 3" />
            <path d="M13 6H6" />
            <path d="M6 13l-3-3 3-3" />
            <path d="M3 10h7" />
          </svg>
        </button>

        {/* Remove from cluster */}
        <button
          className="annotation-btn"
          onClick={() => setRemoveOpen(true)}
          title="Remove from cluster"
          style={{ color: "var(--ink-30)" }}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 4l8 8" />
            <path d="M12 4l-8 8" />
          </svg>
        </button>
      </div>

      {/* Remove confirm modal */}
      {removeOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => !busy && setRemoveOpen(false)}>
          <div style={{ background: "var(--paper)", border: "1px solid var(--border)", borderRadius: 8, boxShadow: "0 8px 32px rgba(0,0,0,0.18)", width: 420, maxWidth: "90vw", padding: 24 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Remove item?</div>
            <p style={{ fontSize: 13, color: "var(--ink-60)", marginBottom: 20, lineHeight: 1.5 }}>
              {titleSnippet} can be removed from this cluster only (it stays in the feed and can be re-clustered), or deleted entirely.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
              <button className="btn-ghost btn" onClick={() => setRemoveOpen(false)} disabled={busy}>Cancel</button>
              <button className="btn" onClick={() => remove(false)} disabled={busy}>
                {busy ? "…" : "Remove from cluster"}
              </button>
              <button
                className="btn"
                style={{ background: "var(--err)", color: "#fff", borderColor: "var(--err)" }}
                onClick={() => remove(true)}
                disabled={busy}
              >
                {busy ? "…" : "Delete everywhere"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Move dialog */}
      {moveOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => !busy && setMoveOpen(false)}>
          <div style={{ background: "var(--paper)", border: "1px solid var(--border)", borderRadius: 8, boxShadow: "0 8px 32px rgba(0,0,0,0.18)", width: 480, maxWidth: "90vw", maxHeight: "80vh", display: "flex", flexDirection: "column" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ padding: "20px 24px 0" }}>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Move item to another cluster</div>
              <p style={{ fontSize: 13, color: "var(--ink-60)", margin: "0 0 12px", lineHeight: 1.5 }}>
                {titleSnippet} will keep its signal classification and analyst notes.
              </p>
              <input
                className="ipt"
                placeholder="Filter clusters…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                autoFocus
                style={{ width: "100%", marginBottom: 8 }}
              />
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "0 24px" }}>
              {targets === null ? (
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-40)", padding: "12px 0" }}>Loading clusters…</div>
              ) : filteredTargets.length === 0 ? (
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-40)", fontStyle: "italic", padding: "12px 0" }}>No other clusters found.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {filteredTargets.map((c) => {
                    const checked = targetId === c.id;
                    return (
                      <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 6, cursor: "pointer", background: checked ? "color-mix(in oklch, var(--accent) 8%, var(--paper))" : "transparent", border: `1px solid ${checked ? "color-mix(in oklch, var(--accent) 30%, transparent)" : "transparent"}` }}>
                        <input
                          type="radio"
                          name="move-target-cluster"
                          checked={checked}
                          onChange={() => setTargetId(c.id)}
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
            <div style={{ padding: "16px 24px 20px", display: "flex", justifyContent: "flex-end", gap: 8, borderTop: "1px solid var(--border-soft)", marginTop: 12 }}>
              <button className="btn-ghost btn" style={{ fontSize: 12 }} onClick={() => setMoveOpen(false)} disabled={busy}>Cancel</button>
              <button className="btn" style={{ fontSize: 12 }} disabled={!targetId || busy} onClick={move}>
                {busy ? "Moving…" : "Move item"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
