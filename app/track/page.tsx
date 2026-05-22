"use client";

import { useEffect, useState, useMemo } from "react";
import { cx, PlatformChip, Sparkline, EntityBadge, Field } from "@/components/primitives";
import { useCompany } from "@/components/CompanyContext";

type Entity = {
  id: string;
  label: string;
  queryString: string;
  entityType: "keyword" | "executive" | "product";
  googleAlertsFeedUrl: string | null;
  createdAt: string;
};

const emptyForm = {
  label: "",
  queryString: "",
  entityType: "keyword" as Entity["entityType"],
  googleAlertsFeedUrl: "",
};

function mergeTwitterHandle(queryString: string, handle: string): string {
  const clean = handle.replace(/^@/, "").trim();
  if (!clean) return queryString;
  const withoutOld = queryString.replace(/\bfrom:\w+/gi, "").trim();
  return [withoutOld, `from:${clean}`].filter(Boolean).join(" ");
}

function extractTwitterHandle(queryString: string): string {
  const m = queryString.match(/\bfrom:(\w+)/i);
  return m ? m[1] : "";
}

function fillSeries(
  sparse: { date: string; count: number }[],
  slots: number,
  stepMs: number
): number[] {
  const map = new Map(sparse.map((r) => [r.date, r.count]));
  const now = Date.now();
  return Array.from({ length: slots }, (_, i) => {
    const t = new Date(now - (slots - 1 - i) * stepMs);
    const key = t.toISOString().slice(0, 10);
    return map.get(key) ?? 0;
  });
}

const entityGlyph = (type: Entity["entityType"]) =>
  type === "executive" ? "◉" : type === "product" ? "◧" : "◇";

export default function TrackPage() {
  const { activeCompanyId } = useCompany();
  const [entities, setEntities] = useState<Entity[]>([]);
  const [type, setType] = useState("all");
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [twitterHandle, setTwitterHandle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [sparklines, setSparklines] = useState<Record<string, number[]>>({});
  const [entityTotals, setEntityTotals] = useState<Record<string, number>>({});

  // Modal state
  const [selectedEntity, setSelectedEntity] = useState<Entity | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [editForm, setEditForm] = useState({
    label: "",
    queryString: "",
    entityType: "keyword" as Entity["entityType"],
    googleAlertsFeedUrl: "",
    twitterHandle: "",
  });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [deleting, setDeleting] = useState(false);

  const load = () => {
    if (!activeCompanyId) return;
    fetch(`/api/entities?companyId=${activeCompanyId}`).then((r) => r.json()).then(setEntities);
  };

  useEffect(() => { load(); }, [activeCompanyId]);

  useEffect(() => {
    if (entities.length === 0) return;
    Promise.all(
      entities.map((e) =>
        fetch(`/api/items/timeseries?entityId=${e.id}&days=14`)
          .then((r) => r.json())
          .then((d) => {
            const series = fillSeries(d.series, 14, 86400000);
            const total = (d.series as { count: number }[]).reduce((s, r) => s + r.count, 0);
            return [e.id, series, total] as const;
          })
      )
    ).then((results) => {
      setSparklines(Object.fromEntries(results.map(([id, s]) => [id, s])));
      setEntityTotals(Object.fromEntries(results.map(([id, , t]) => [id, t])));
    });
  }, [entities]);

  // Pre-fill edit form when modal opens
  useEffect(() => {
    if (!selectedEntity) return;
    setEditMode(false);
    setConfirmingDelete(false);
    setEditError("");
    setEditForm({
      label: selectedEntity.label,
      queryString: selectedEntity.queryString,
      entityType: selectedEntity.entityType,
      googleAlertsFeedUrl: selectedEntity.googleAlertsFeedUrl ?? "",
      twitterHandle: extractTwitterHandle(selectedEntity.queryString),
    });
  }, [selectedEntity]);

  // Escape key closes modal
  useEffect(() => {
    if (!selectedEntity) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setSelectedEntity(null); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [selectedEntity]);

  const counts = useMemo(() => {
    const c = { all: entities.length, keyword: 0, executive: 0, product: 0 };
    for (const e of entities) c[e.entityType]++;
    return c;
  }, [entities]);

  const filtered = useMemo(() => {
    return entities.filter((e) => {
      if (type !== "all" && e.entityType !== type) return false;
      if (query) {
        const q = query.toLowerCase();
        if (!e.label.toLowerCase().includes(q) && !e.queryString.toLowerCase().includes(q))
          return false;
      }
      return true;
    });
  }, [entities, type, query]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    const finalQuery = mergeTwitterHandle(form.queryString, twitterHandle);
    const res = await fetch("/api/entities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, queryString: finalQuery, companyId: activeCompanyId }),
    });
    if (res.ok) {
      setForm(emptyForm);
      setTwitterHandle("");
      setAdding(false);
      await load();
    } else {
      setError("Failed to save.");
    }
    setSaving(false);
  };

  const handleEditSave = async () => {
    if (!selectedEntity) return;
    setEditSaving(true);
    setEditError("");
    const finalQuery = mergeTwitterHandle(editForm.queryString, editForm.twitterHandle);
    const res = await fetch(`/api/entities/${selectedEntity.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: editForm.label,
        queryString: finalQuery,
        entityType: editForm.entityType,
        googleAlertsFeedUrl: editForm.googleAlertsFeedUrl,
      }),
    });
    if (res.ok) {
      setSelectedEntity(null);
      await load();
    } else {
      setEditError("Failed to save changes.");
    }
    setEditSaving(false);
  };

  const handleDelete = async () => {
    if (!selectedEntity) return;
    setDeleting(true);
    await fetch(`/api/entities/${selectedEntity.id}`, { method: "DELETE" });
    setSelectedEntity(null);
    setDeleting(false);
    await load();
  };

  const modalSources = selectedEntity
    ? ["hackernews", "reddit", "twitter"].concat(selectedEntity.googleAlertsFeedUrl ? ["google_alerts"] : [])
    : [];

  return (
    <>
      <header className="topbar">
        <div>
          <div className="eyebrow">Part 1 · Ingestion</div>
          <h1 className="page-title">Tracked entities</h1>
          <p className="page-desc">Keywords, products and executives the system monitors.</p>
        </div>
        <div className="topbar-actions">
          <label className="search">
            <span className="search-icon">⌕</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter entities…"
            />
          </label>
          <button className="btn btn-primary" onClick={() => setAdding(!adding)}>
            {adding ? "✕ Cancel" : "+ Add entity"}
          </button>
        </div>
      </header>

      <div className="page">
        <div className="track-summary">
          <div className="sumstat">
            <div className="sumstat-label">Tracked entities</div>
            <div className="sumstat-value">{counts.all}</div>
            <div className="sumstat-hint">{counts.keyword} keywords · {counts.product} products · {counts.executive} executives</div>
          </div>
          <div className="sumstat">
            <div className="sumstat-label">With Google Alerts</div>
            <div className="sumstat-value">{entities.filter((e) => e.googleAlertsFeedUrl).length}</div>
            <div className="sumstat-hint">RSS feed configured</div>
          </div>
          <div className="sumstat sumstat-accent">
            <div className="sumstat-label">Keywords</div>
            <div className="sumstat-value">{counts.keyword}</div>
            <div className="sumstat-hint">Brand + topic terms</div>
          </div>
          <div className="sumstat sumstat-accent">
            <div className="sumstat-label">People tracked</div>
            <div className="sumstat-value">{counts.executive}</div>
            <div className="sumstat-hint">Executives + influencers</div>
          </div>
        </div>

        <div className="toolbar">
          <div className="filter-group">
            <span className="filter-label">Type</span>
            <div className="seg">
              {(["all", "keyword", "product", "executive"] as const).map((t) => (
                <button
                  key={t}
                  className={cx("seg-btn", type === t && "seg-btn-on")}
                  onClick={() => setType(t)}
                >
                  {t !== "all" && (
                    <span className={`ebadge-glyph eg-${t}`}>{entityGlyph(t as Entity["entityType"])}</span>
                  )}
                  {t === "all" ? "All" : t[0].toUpperCase() + t.slice(1)}{" "}
                  <span className="seg-count">{counts[t]}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="filter-group filter-group-right">
            <button className="btn btn-primary" onClick={() => setAdding(!adding)}>
              {adding ? "✕ Cancel" : "+ Add entity"}
            </button>
          </div>
        </div>

        {adding && (
          <form className="addcard" onSubmit={handleSubmit}>
            <div className="addcard-head">
              <span className="kbd">New</span>
              <span>Add a tracked entity. The query runs against every active source on the next hourly poll.</span>
            </div>
            <div className="addcard-grid">
              <Field label="Label" hint="Display name used everywhere">
                <input
                  className="ipt"
                  placeholder="e.g. Sam Altman — CEO"
                  value={form.label}
                  onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                  required
                />
              </Field>
              <Field label="Type">
                <div className="seg">
                  {(["keyword", "product", "executive"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={cx("seg-btn", form.entityType === t && "seg-btn-on")}
                      onClick={() => setForm((f) => ({ ...f, entityType: t }))}
                    >
                      <span className={`ebadge-glyph eg-${t}`}>{entityGlyph(t)}</span>
                      {t[0].toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                </div>
              </Field>
              <Field
                label="Twitter / X account"
                hint="@handle of the account to track on X/Twitter — automatically added to the search query"
              >
                <input
                  className="ipt mono"
                  placeholder="@sama"
                  value={twitterHandle}
                  onChange={(e) => setTwitterHandle(e.target.value)}
                />
              </Field>
              <Field
                label="Search query"
                hint='Boolean operators: "exact phrase" OR term1 OR term2 · commas are not supported'
                full
              >
                <input
                  className="ipt mono"
                  placeholder='"Sam Altman" OR "sama"'
                  value={form.queryString}
                  onChange={(e) => setForm((f) => ({ ...f, queryString: e.target.value }))}
                  required
                />
              </Field>
              <Field
                label="Google Alerts RSS"
                hint="Paste the feed URL from your Google Alert (optional)"
                full
              >
                <input
                  className="ipt mono"
                  placeholder="https://www.google.com/alerts/feeds/…"
                  value={form.googleAlertsFeedUrl}
                  onChange={(e) => setForm((f) => ({ ...f, googleAlertsFeedUrl: e.target.value }))}
                />
              </Field>
            </div>
            <div className="addcard-foot">
              <div className="addcard-platforms">
                <span className="dim">Will be polled on:</span>
                <PlatformChip platform="hackernews" />
                <PlatformChip platform="reddit" />
                <PlatformChip platform="twitter" />
                {form.googleAlertsFeedUrl && <PlatformChip platform="google_alerts" />}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {error && <span style={{ color: "var(--err)", fontSize: 12 }}>{error}</span>}
                <button type="button" className="btn btn-ghost" onClick={() => setAdding(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? "Adding…" : "Add entity"}
                </button>
              </div>
            </div>
          </form>
        )}

        <div className="tbl-wrap">
          <table className="tbl tbl-entities">
            <thead>
              <tr>
                <th style={{ width: 28 }} />
                <th>Entity</th>
                <th style={{ width: 110 }}>Type</th>
                <th>Search query</th>
                <th style={{ width: 120 }}>Sources</th>
                <th style={{ width: 150 }}>Volume</th>
                <th style={{ width: 100 }}>Added</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => {
                const sources = ["hackernews", "reddit", "twitter"].concat(
                  e.googleAlertsFeedUrl ? ["google_alerts"] : []
                );
                const spark = sparklines[e.id] ?? [];
                return (
                  <tr key={e.id} className="entity-row">
                    <td>
                      <span className={cx("ebadge-glyph", `eg-${e.entityType}`)}>
                        {entityGlyph(e.entityType)}
                      </span>
                    </td>
                    <td
                      className="entity-label entity-label-link"
                      onClick={() => setSelectedEntity(e)}
                    >
                      {e.label}
                    </td>
                    <td>
                      <span className={cx("type-pill", `type-${e.entityType}`)}>
                        {e.entityType}
                      </span>
                    </td>
                    <td>
                      <code className="codepill">{e.queryString}</code>
                    </td>
                    <td>
                      <div className="src-stack">
                        {sources.map((s) => (
                          <PlatformChip key={s} platform={s} />
                        ))}
                      </div>
                    </td>
                    <td>
                      <div className="vol-cell">
                        <Sparkline values={spark} color="var(--ink-50)" height={20} />
                        <span className="mono">{entityTotals[e.id] ?? "—"}</span>
                      </div>
                    </td>
                    <td className="mono dim">
                      {new Date(e.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="empty">
              <div className="empty-mark">∅</div>
              <div className="empty-title">No entities yet</div>
              <div className="empty-sub">Add your first keyword, product, or executive above.</div>
            </div>
          )}
        </div>
      </div>

      {/* Entity detail / edit modal */}
      {selectedEntity && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setSelectedEntity(null)}
        >
          <div
            style={{ background: "var(--paper)", border: "1px solid var(--border)", borderRadius: 8, boxShadow: "0 8px 32px rgba(0,0,0,0.18)", width: 560, maxWidth: "94vw", maxHeight: "88vh", display: "flex", flexDirection: "column" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ padding: "14px 16px 12px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10 }}>
              <span className={cx("ebadge-glyph", `eg-${selectedEntity.entityType}`)} style={{ fontSize: 16 }}>
                {entityGlyph(selectedEntity.entityType)}
              </span>
              <span style={{ fontSize: 14, fontWeight: 600, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {selectedEntity.label}
              </span>
              <span className={cx("type-pill", `type-${selectedEntity.entityType}`)} style={{ flexShrink: 0 }}>
                {selectedEntity.entityType}
              </span>
              <button className="btn btn-ghost" style={{ fontSize: 11, padding: "2px 8px", flexShrink: 0 }} onClick={() => setSelectedEntity(null)}>✕</button>
            </div>

            {/* Body */}
            <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
              {confirmingDelete ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div className="banner" style={{ background: "oklch(0.96 0.05 25)", color: "var(--err)", border: "1px solid oklch(0.86 0.10 25)" }}>
                    This will permanently remove <strong>{selectedEntity.label}</strong> and all linked clusters. Ingested items will be kept but unlinked.
                  </div>
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                    <button className="btn btn-ghost" onClick={() => setConfirmingDelete(false)} disabled={deleting}>
                      Cancel
                    </button>
                    <button
                      className="btn"
                      style={{ background: "var(--err)", color: "#fff", border: "none" }}
                      onClick={handleDelete}
                      disabled={deleting}
                    >
                      {deleting ? "Deleting…" : "Confirm delete"}
                    </button>
                  </div>
                </div>
              ) : editMode ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <Field label="Label" hint="Display name used everywhere">
                    <input
                      className="ipt"
                      value={editForm.label}
                      onChange={(e) => setEditForm((f) => ({ ...f, label: e.target.value }))}
                    />
                  </Field>
                  <Field label="Type">
                    <div className="seg">
                      {(["keyword", "product", "executive"] as const).map((t) => (
                        <button
                          key={t}
                          type="button"
                          className={cx("seg-btn", editForm.entityType === t && "seg-btn-on")}
                          onClick={() => setEditForm((f) => ({ ...f, entityType: t }))}
                        >
                          <span className={`ebadge-glyph eg-${t}`}>{entityGlyph(t)}</span>
                          {t[0].toUpperCase() + t.slice(1)}
                        </button>
                      ))}
                    </div>
                  </Field>
                  <Field
                    label="Twitter / X account"
                    hint="@handle of the account to track — automatically merged into the search query"
                  >
                    <input
                      className="ipt mono"
                      placeholder="@sama"
                      value={editForm.twitterHandle}
                      onChange={(e) => setEditForm((f) => ({ ...f, twitterHandle: e.target.value }))}
                    />
                  </Field>
                  <Field
                    label="Search query"
                    hint='Boolean operators: "exact phrase" OR term1 OR term2'
                  >
                    <input
                      className="ipt mono"
                      value={editForm.queryString}
                      onChange={(e) => setEditForm((f) => ({ ...f, queryString: e.target.value }))}
                    />
                  </Field>
                  <Field label="Google Alerts RSS" hint="RSS feed URL from your Google Alert (optional)">
                    <input
                      className="ipt mono"
                      placeholder="https://www.google.com/alerts/feeds/…"
                      value={editForm.googleAlertsFeedUrl}
                      onChange={(e) => setEditForm((f) => ({ ...f, googleAlertsFeedUrl: e.target.value }))}
                    />
                  </Field>
                  {editError && <span style={{ color: "var(--err)", fontSize: 12 }}>{editError}</span>}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                  {[
                    {
                      label: "Search query",
                      value: <code className="codepill" style={{ fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{selectedEntity.queryString}</code>,
                    },
                    ...(extractTwitterHandle(selectedEntity.queryString)
                      ? [{
                          label: "Twitter / X account",
                          value: <span className="mono" style={{ fontSize: 13 }}>@{extractTwitterHandle(selectedEntity.queryString)}</span>,
                        }]
                      : []),
                    {
                      label: "Google Alerts",
                      value: selectedEntity.googleAlertsFeedUrl
                        ? <a href={selectedEntity.googleAlertsFeedUrl} target="_blank" rel="noreferrer" className="mono" style={{ fontSize: 11, color: "var(--accent)", wordBreak: "break-all" }}>{selectedEntity.googleAlertsFeedUrl}</a>
                        : <span style={{ color: "var(--ink-40)", fontSize: 13 }}>—</span>,
                    },
                    {
                      label: "Sources",
                      value: (
                        <div className="src-stack" style={{ paddingTop: 2 }}>
                          {modalSources.map((s) => <PlatformChip key={s} platform={s} />)}
                        </div>
                      ),
                    },
                    {
                      label: "Added",
                      value: <span className="mono" style={{ fontSize: 13 }}>{new Date(selectedEntity.createdAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}</span>,
                    },
                  ].map(({ label, value }) => (
                    <div key={label} style={{ display: "flex", gap: 16, padding: "10px 0", borderBottom: "1px solid var(--border-soft)" }}>
                      <div style={{ width: 130, flexShrink: 0, fontSize: 11.5, fontWeight: 500, color: "var(--ink-60)", fontFamily: "var(--font-mono)", paddingTop: 2 }}>{label}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>{value}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            {!confirmingDelete && (
              <div style={{ padding: "10px 16px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                {editMode ? (
                  <>
                    <div />
                    <div style={{ display: "flex", gap: 8 }}>
                      <button className="btn btn-ghost" onClick={() => setEditMode(false)} disabled={editSaving}>Cancel</button>
                      <button className="btn btn-primary" onClick={handleEditSave} disabled={editSaving}>
                        {editSaving ? "Saving…" : "Save changes"}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <button
                      className="btn btn-ghost"
                      style={{ color: "var(--err)" }}
                      onClick={() => setConfirmingDelete(true)}
                    >
                      Delete…
                    </button>
                    <button className="btn btn-primary" onClick={() => setEditMode(true)}>
                      Edit
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
