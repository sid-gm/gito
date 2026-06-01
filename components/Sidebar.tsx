"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { cx, Dot } from "@/components/primitives";
import { useCompany } from "@/components/CompanyContext";

const SOURCES_NAV = [
  { href: "/",        label: "Feed",    glyph: "≡" },
  { href: "/track",   label: "Track",   glyph: "◆" },
  { href: "/sources", label: "Sources", glyph: "◴" },
  { href: "/submit",  label: "Manual",  glyph: "✎" },
];


export function Sidebar() {
  const path = usePathname();
  const { companies, activeCompany, setActiveCompanyId, createCompany, renameCompany, deleteCompany } = useCompany();

  const [showSwitcher, setShowSwitcher] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const [showSettings, setShowSettings] = useState(false);
  const [deleteStep, setDeleteStep] = useState<"idle" | "confirm">("idle");
  const [deleteInput, setDeleteInput] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  function openSettings() { setShowSettings(true); setDeleteStep("idle"); setDeleteInput(""); }
  function closeSettings() { setShowSettings(false); setDeleteStep("idle"); setDeleteInput(""); }

  async function handleDeleteConfirm() {
    if (!activeCompany || deleteInput !== activeCompany.name) return;
    setDeleting(true);
    try {
      await deleteCompany(activeCompany.id);
      closeSettings();
    } finally {
      setDeleting(false);
    }
  }

  useEffect(() => {
    if (!showSwitcher) return;
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowSwitcher(false);
        setAdding(false);
        setNewName("");
        setEditingId(null);
        setEditingName("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showSwitcher]);

  const sinceYear = activeCompany
    ? new Date(activeCompany.createdAt).getFullYear()
    : "—";

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setSaving(true);
    try {
      await createCompany(name);
      setNewName("");
      setAdding(false);
      setShowSwitcher(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleRename(e: React.FormEvent, id: string) {
    e.preventDefault();
    const name = editingName.trim();
    if (!name) return;
    setRenameSaving(true);
    try {
      await renameCompany(id, name);
      setEditingId(null);
      setEditingName("");
    } finally {
      setRenameSaving(false);
    }
  }

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <span className="brand-mark-inner">GT</span>
        </div>
        <div className="brand-text">
          <div className="brand-title">Gito</div>
          <div className="brand-sub">Signal-to-noise · v0.1</div>
        </div>
      </div>

      <div className="company-wrap" ref={wrapperRef}>
        <button
          className={cx("company company-btn", showSwitcher && "company-btn-open")}
          onClick={() => { setShowSwitcher((v) => !v); setAdding(false); setNewName(""); }}
          title="Switch company"
        >
          <div className="company-name">{activeCompany?.name ?? "—"}</div>
          <div className="company-meta">
            <span className="kbd">—</span>
            <span>·</span>
            <span>Since {sinceYear}</span>
            <span className="company-caret">{showSwitcher ? "▲" : "▼"}</span>
          </div>
        </button>

        {showSwitcher && (
          <div className="company-switcher">
            {companies.map((c) => (
              editingId === c.id ? (
                <form key={c.id} className="company-switcher-new" onSubmit={(e) => handleRename(e, c.id)}>
                  <input
                    autoFocus
                    className="company-switcher-input"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    disabled={renameSaving}
                  />
                  <button type="submit" className="company-switcher-save" disabled={renameSaving || !editingName.trim()}>
                    {renameSaving ? "…" : "Save"}
                  </button>
                  <button type="button" className="company-switcher-cancel" onClick={() => { setEditingId(null); setEditingName(""); }}>
                    ✕
                  </button>
                </form>
              ) : (
                <div key={c.id} className={cx("company-switcher-item", c.id === activeCompany?.id && "company-switcher-item-active")}>
                  <button
                    className="company-switcher-select"
                    onClick={() => { setActiveCompanyId(c.id); setShowSwitcher(false); }}
                  >
                    <span className="company-switcher-check">{c.id === activeCompany?.id ? "✓" : ""}</span>
                    <span>{c.name}</span>
                  </button>
                  <button
                    className="company-switcher-edit"
                    title="Rename"
                    onClick={(e) => { e.stopPropagation(); setEditingId(c.id); setEditingName(c.name); setAdding(false); }}
                  >
                    ✎
                  </button>
                </div>
              )
            ))}

            <div className="company-switcher-divider" />

            {adding ? (
              <form className="company-switcher-new" onSubmit={handleCreate}>
                <input
                  autoFocus
                  className="company-switcher-input"
                  placeholder="Company name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  disabled={saving}
                />
                <button type="submit" className="company-switcher-save" disabled={saving || !newName.trim()}>
                  {saving ? "…" : "Add"}
                </button>
                <button type="button" className="company-switcher-cancel" onClick={() => { setAdding(false); setNewName(""); }}>
                  ✕
                </button>
              </form>
            ) : (
              <button className="company-switcher-add" onClick={() => setAdding(true)}>
                + New company
              </button>
            )}
          </div>
        )}
      </div>

      <nav className="nav">
        <div className="nav-section">Sources Tracker</div>
        {SOURCES_NAV.map((n) => {
          const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              className={cx("nav-item nav-item-sub", active && "nav-item-on")}
            >
              <span className="nav-glyph">{n.glyph}</span>
              <span className="nav-label">{n.label}</span>
            </Link>
          );
        })}

        <div className="nav-section" style={{ marginTop: 16 }}>Classify</div>
        <Link
          href="/clusters"
          className={cx("nav-item nav-item-sub", path === "/clusters" && "nav-item-on")}
        >
          <span className="nav-glyph">◎</span>
          <span className="nav-label">Cluster Review</span>
        </Link>
        <Link
          href="/narratives"
          className={cx("nav-item nav-item-sub", path === "/narratives" && "nav-item-on")}
        >
          <span className="nav-glyph">◈</span>
          <span className="nav-label">Global Narratives</span>
        </Link>

        <div className="nav-section" style={{ marginTop: 16 }}>Publish</div>
        <Link
          href="/daily-report"
          className={cx("nav-item nav-item-sub", path === "/daily-report" && "nav-item-on")}
        >
          <span className="nav-glyph">◐</span>
          <span className="nav-label">Daily reports</span>
        </Link>
        <Link
          href="/report"
          className={cx("nav-item nav-item-sub", path.startsWith("/report") && "nav-item-on")}
        >
          <span className="nav-glyph">◉</span>
          <span className="nav-label">Signal briefs</span>
        </Link>
      </nav>

      <div className="sb-foot">
        <div className="sb-foot-row">
          <Dot color="var(--ok)" pulse />
          <span>Cron healthy · hourly</span>
        </div>
        <div className="sb-foot-row sb-foot-row-mono">
          <span className="kbd">⌘K</span>
          <span>Quick command</span>
        </div>
        <button className="sb-settings-btn" onClick={openSettings}>
          ⚙ Settings
        </button>
      </div>

      {mounted && showSettings && createPortal(
        <div className="modal-overlay" onClick={closeSettings}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">
                {deleteStep === "confirm" ? "Delete project" : "Settings"}
              </span>
              <button className="modal-close" onClick={closeSettings}>✕</button>
            </div>

            {deleteStep === "idle" && (
              <div className="modal-body">
                <p className="modal-project-name">{activeCompany?.name}</p>
                <div className="modal-divider" />
                <button className="modal-danger-row" onClick={() => setDeleteStep("confirm")}>
                  <span className="modal-danger-icon">⚠</span>
                  <span>Delete this project</span>
                </button>
              </div>
            )}

            {deleteStep === "confirm" && (
              <div className="modal-body">
                <p className="modal-warn-text">
                  This will permanently delete <strong>{activeCompany?.name}</strong> and all its data. This action cannot be undone.
                </p>
                <label className="modal-label">
                  Type the project name to confirm
                </label>
                <input
                  autoFocus
                  className="modal-input"
                  placeholder={activeCompany?.name}
                  value={deleteInput}
                  onChange={(e) => setDeleteInput(e.target.value)}
                  disabled={deleting}
                />
                <div className="modal-actions">
                  <button
                    className="modal-btn-cancel"
                    onClick={() => { setDeleteStep("idle"); setDeleteInput(""); }}
                    disabled={deleting}
                  >
                    Cancel
                  </button>
                  <button
                    className="modal-btn-delete"
                    onClick={handleDeleteConfirm}
                    disabled={deleting || deleteInput !== activeCompany?.name}
                  >
                    {deleting ? "Deleting…" : "Delete project"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </aside>
  );
}
