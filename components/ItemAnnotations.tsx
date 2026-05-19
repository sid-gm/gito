"use client";

import { useState, useRef, useEffect, useCallback } from "react";

type AnalystFlag = "review" | "highlight" | null;

export function ItemAnnotations({
  clusterId,
  itemId,
  note,
  flag,
  onUpdate,
}: {
  clusterId: string;
  itemId: string;
  note: string | null;
  flag: AnalystFlag;
  onUpdate: (note: string | null, flag: AnalystFlag) => void;
}) {
  const [localNote, setLocalNote] = useState(note);
  const [localFlag, setLocalFlag] = useState<AnalystFlag>(flag);
  const [noteOpen, setNoteOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const savedNoteRef = useRef(note);

  useEffect(() => { setLocalNote(note); savedNoteRef.current = note; }, [note]);
  useEffect(() => { setLocalFlag(flag); }, [flag]);
  useEffect(() => { if (noteOpen) textareaRef.current?.focus(); }, [noteOpen]);

  const saveNote = useCallback(async () => {
    const trimmed = localNote?.trim() || null;
    if (trimmed === savedNoteRef.current) {
      setNoteOpen(false);
      return;
    }
    setSaving(true);
    await fetch(`/api/clusters/${clusterId}/items/${itemId}/annotate`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note: trimmed }),
    });
    savedNoteRef.current = trimmed;
    setSaving(false);
    setNoteOpen(false);
    onUpdate(trimmed, localFlag);
  }, [clusterId, itemId, localNote, localFlag, onUpdate]);

  useEffect(() => {
    if (!noteOpen) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        saveNote();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [noteOpen, saveNote]);

  const cycleFlag = async () => {
    const next: AnalystFlag =
      localFlag === null ? "review" : localFlag === "review" ? "highlight" : null;
    setLocalFlag(next);
    await fetch(`/api/clusters/${clusterId}/items/${itemId}/annotate`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flag: next }),
    });
    onUpdate(savedNoteRef.current, next);
  };

  const flagColor =
    localFlag === "review" ? "var(--amber, #d97706)" :
    localFlag === "highlight" ? "var(--green, #16a34a)" :
    "var(--ink-20)";

  const flagTitle =
    localFlag === "review" ? "Flagged: review later (click to highlight)" :
    localFlag === "highlight" ? "Flagged: key link (click to clear)" :
    "Flag this link (review / highlight)";

  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      <div className={`item-annotation-icons${(localNote || localFlag) ? " has-content" : ""}`}>
        {/* Note icon */}
        <button
          className="annotation-btn"
          onClick={() => setNoteOpen((v) => !v)}
          title={localNote ? `Note: ${localNote}` : "Add note"}
          style={{ color: localNote ? "var(--accent)" : undefined }}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2l2 2-8 8H4v-2L12 2z" />
            <path d="M2 14h12" />
          </svg>
        </button>

        {/* Flag icon */}
        <button
          className="annotation-btn"
          onClick={cycleFlag}
          title={flagTitle}
          style={{ color: flagColor, opacity: localFlag ? 1 : undefined }}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill={localFlag ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 2v12" />
            <path d="M3 2l10 4-10 4" />
          </svg>
        </button>
      </div>

      {/* Note popover */}
      {noteOpen && (
        <div ref={popoverRef} className="item-note-popover">
          <textarea
            ref={textareaRef}
            className="item-note-textarea"
            value={localNote ?? ""}
            onChange={(e) => setLocalNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") { setLocalNote(savedNoteRef.current); setNoteOpen(false); }
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveNote();
            }}
            placeholder="Add note… (⌘↵ to save, Esc to cancel)"
            rows={4}
            disabled={saving}
          />
          <div className="item-note-actions">
            <button className="item-note-save-btn" onClick={saveNote} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              className="item-note-cancel-btn"
              onClick={() => { setLocalNote(savedNoteRef.current); setNoteOpen(false); }}
              disabled={saving}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
