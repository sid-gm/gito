"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAnalyst } from "@/components/analyst/AnalystContext";

/* Header company selector: shows the active company name, opens a menu to
   switch between companies, and lets you create a new one inline. */
export function CompanySwitcher() {
  const { companies, companyId, setCompanyId, createCompany } = useAnalyst();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const active = companies.find((c) => c.id === companyId);

  const close = useCallback(() => {
    setOpen(false);
    setCreating(false);
    setName("");
  }, []);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        close();
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  // Focus the input when the create form appears.
  useEffect(() => {
    if (creating) inputRef.current?.focus();
  }, [creating]);

  function pick(id: string) {
    setCompanyId(id);
    close();
  }

  async function submitNew() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    const company = await createCompany(trimmed);
    setBusy(false);
    if (company) close();
  }

  if (companies.length === 0) return null;

  return (
    <div className="an-company" ref={rootRef}>
      <button
        type="button"
        className="an-company-trigger"
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="an-company-name">{active?.name ?? "Select company"}</span>
        <svg
          className={`an-company-caret${open ? " an-company-caret-up" : ""}`}
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="an-company-menu" role="menu">
          <div className="an-company-list">
            {companies.map((c) => (
              <button
                key={c.id}
                type="button"
                role="menuitemradio"
                aria-checked={c.id === companyId}
                className={`an-company-item${c.id === companyId ? " an-company-item-on" : ""}`}
                onClick={() => pick(c.id)}
              >
                <span className="an-company-item-name">{c.name}</span>
                {c.id === companyId && (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            ))}
          </div>

          <div className="an-company-sep" />

          {creating ? (
            <div className="an-company-create">
              <input
                ref={inputRef}
                className="an-input"
                placeholder="Company name…"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitNew();
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    setCreating(false);
                  }
                }}
              />
              <button
                type="button"
                className="an-btn"
                onClick={submitNew}
                disabled={busy || !name.trim()}
              >
                {busy ? "Adding…" : "Add"}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="an-company-item an-company-new"
              onClick={() => setCreating(true)}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              <span>New company</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
