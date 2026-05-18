"use client";

import { useEffect, useRef, useState } from "react";
import { PlatformChip } from "@/components/primitives";

type CandidateItem = {
  id: string;
  title: string | null;
  url: string | null;
  platform: string;
  author: string | null;
  publishedAt: string | null;
  createdAt: string;
};

type Props = {
  clusterId: string;
  clusterEntityId: string | null;
  onAdded: () => void;
  onClose: () => void;
};

const emptyForm = { url: "", title: "", body: "", author: "", publishedAt: "" };

export function AddItemDialog({ clusterId, clusterEntityId, onAdded, onClose }: Props) {
  const [tab, setTab] = useState<"feed" | "manual">("feed");

  // Feed tab state
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<CandidateItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);

  // Manual tab state
  const [form, setForm] = useState(emptyForm);
  const [fetchingMeta, setFetchingMeta] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.length < 2) { setCandidates([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/clusters/${clusterId}/candidates?q=${encodeURIComponent(query)}`);
        if (res.ok) setCandidates(await res.json());
      } catch { /* best-effort */ }
      setSearching(false);
    }, 350);
  }, [query, clusterId]);

  const handleLink = async () => {
    if (!selectedId) return;
    setLinking(true);
    await fetch(`/api/clusters/${clusterId}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId: selectedId }),
    });
    setLinking(false);
    onAdded();
    onClose();
  };

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const handleFetch = async () => {
    if (!form.url) return;
    setFetchingMeta(true);
    try {
      const res = await fetch(`/api/meta?url=${encodeURIComponent(form.url)}`);
      if (res.ok) {
        const data = await res.json();
        setForm((f) => ({ ...f, title: data.title ?? f.title, author: data.author ?? f.author }));
      }
    } catch { /* best-effort */ }
    setFetchingMeta(false);
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title) return;
    setSubmitting(true);
    setError("");
    try {
      const createRes = await fetch("/api/items/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          entityId: clusterEntityId ?? undefined,
        }),
      });
      if (!createRes.ok) { setError("Failed to create item. Check required fields."); setSubmitting(false); return; }
      const newItem = await createRes.json();
      await fetch(`/api/clusters/${clusterId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: newItem.id }),
      });
      onAdded();
      onClose();
    } catch {
      setError("Something went wrong. Please try again.");
    }
    setSubmitting(false);
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}
    >
      <div
        style={{ background: "var(--paper)", border: "1px solid var(--border)", borderRadius: 8, boxShadow: "0 8px 32px rgba(0,0,0,0.18)", width: 520, maxWidth: "92vw", maxHeight: "85vh", display: "flex", flexDirection: "column" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: "0.01em" }}>Add item to cluster</span>
          <button className="btn btn-ghost" style={{ fontSize: 11, padding: "2px 8px" }} onClick={onClose}>✕</button>
        </div>

        {/* Tab switcher */}
        <div style={{ display: "flex", gap: 6, padding: "10px 16px 0" }}>
          {(["feed", "manual"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                fontSize: 11,
                fontFamily: "var(--font-mono)",
                padding: "4px 12px",
                borderRadius: 4,
                border: `1px solid ${tab === t ? "var(--accent)" : "var(--border)"}`,
                background: tab === t ? "color-mix(in oklch, var(--accent) 10%, var(--paper))" : "transparent",
                color: tab === t ? "var(--accent)" : "var(--ink-60)",
                cursor: "pointer",
                letterSpacing: "0.05em",
              }}
            >
              {t === "feed" ? "From feed" : "Manual entry"}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px 16px" }}>
          {tab === "feed" && (
            <div className="form-stack">
              <div className="ipt-wrap">
                <input
                  className="ipt"
                  placeholder="Search by title or URL…"
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setSelectedId(null); }}
                  autoFocus
                />
                {searching && (
                  <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: "var(--ink-40)" }}>…</span>
                )}
              </div>
              {query.length >= 2 && candidates.length === 0 && !searching && (
                <div style={{ fontSize: 12, color: "var(--ink-40)", padding: "8px 0" }}>No results.</div>
              )}
              {candidates.length > 0 && (
                <div style={{ maxHeight: 300, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 4 }}>
                  {candidates.map((c) => (
                    <div
                      key={c.id}
                      className="cluster-item-row"
                      style={{
                        cursor: "pointer",
                        background: selectedId === c.id ? "color-mix(in oklch, var(--accent) 8%, var(--paper))" : undefined,
                        borderLeft: selectedId === c.id ? "2px solid var(--accent)" : "2px solid transparent",
                        padding: "6px 10px",
                      }}
                      onClick={() => setSelectedId(c.id)}
                    >
                      <PlatformChip platform={c.platform} size="sm" />
                      <span className="cluster-item-title" style={{ flex: 1, minWidth: 0 }}>
                        {c.title ?? c.url ?? c.id}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === "manual" && (
            <form id="add-item-manual-form" className="form-stack" onSubmit={handleManualSubmit}>
              <div>
                <div className="field-label">URL</div>
                <div className="ipt-wrap">
                  <input
                    className="ipt mono"
                    placeholder="https://…"
                    type="url"
                    value={form.url}
                    onChange={(e) => set("url", e.target.value)}
                  />
                  <button
                    type="button"
                    className="ipt-action"
                    onClick={handleFetch}
                    disabled={!form.url || fetchingMeta}
                  >
                    {fetchingMeta ? "Fetching…" : "Fetch metadata"}
                  </button>
                </div>
              </div>

              <div>
                <div className="field-label">Title <span style={{ color: "var(--err)" }}>*</span></div>
                <input
                  className="ipt"
                  placeholder="Article or post title"
                  value={form.title}
                  onChange={(e) => set("title", e.target.value)}
                  required
                />
              </div>

              <div>
                <div className="field-label">Summary / body</div>
                <textarea
                  className="ipt ipt-area"
                  rows={4}
                  placeholder="Paste the key content or write a summary…"
                  value={form.body}
                  onChange={(e) => set("body", e.target.value)}
                />
              </div>

              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div className="field-label">Author / handle</div>
                  <input
                    className="ipt"
                    placeholder="@author or Author Name"
                    value={form.author}
                    onChange={(e) => set("author", e.target.value)}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <div className="field-label">Published date</div>
                  <input
                    className="ipt mono"
                    type="date"
                    value={form.publishedAt}
                    onChange={(e) => set("publishedAt", e.target.value)}
                  />
                </div>
              </div>

              {error && (
                <div className="banner" style={{ background: "oklch(0.96 0.05 25)", color: "var(--err)", border: "1px solid oklch(0.86 0.10 25)" }}>
                  {error}
                </div>
              )}
            </form>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "10px 16px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          {tab === "feed" ? (
            <button className="btn btn-primary" disabled={!selectedId || linking} onClick={handleLink}>
              {linking ? "Adding…" : "Add to cluster"}
            </button>
          ) : (
            <button type="submit" form="add-item-manual-form" className="btn btn-primary" disabled={submitting || !form.title}>
              {submitting ? "Submitting…" : "Submit & add"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
