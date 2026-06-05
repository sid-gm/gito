"use client";

import { useState } from "react";

type ParsedInstagramComment = {
  author: string;
  body: string;
  timestamp: string | null;
};

interface Props {
  clusterId: string;
  postUrl: string;
  entityId: string | null;
  onClose: () => void;
  onInserted: (count: number) => void;
}

export default function InstagramCommentIngestDialog({ clusterId, postUrl, onClose, onInserted }: Props) {
  const [url, setUrl] = useState(postUrl);
  const [pasteText, setPasteText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [comments, setComments] = useState<ParsedInstagramComment[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [error, setError] = useState("");

  async function parsePaste() {
    if (!pasteText.trim()) return;
    setParsing(true);
    setComments([]);
    setSelected(new Set());
    setError("");
    try {
      const res = await fetch("/api/items/manual/parse-instagram-comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: pasteText }),
      });
      const data = await res.json();
      const parsed: ParsedInstagramComment[] = data.comments ?? [];
      setComments(parsed);
      setSelected(new Set(parsed.map((_, i) => i)));
    } catch {
      setError("Failed to parse — check the pasted text and try again.");
    } finally {
      setParsing(false);
    }
  }

  async function submit() {
    const picked = comments.filter((_, i) => selected.has(i));
    if (picked.length === 0) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch(`/api/clusters/${clusterId}/ingest-instagram-comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comments: picked, postUrl: url.trim() || postUrl }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ? JSON.stringify(data.error) : `Error ${res.status}`);
        return;
      }
      const data = await res.json();
      setDone(data.inserted ?? 0);
      onInserted(data.inserted ?? 0);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function toggle(i: number) {
    setSelected((s) => {
      const next = new Set(s);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }

  function toggleAll() {
    const allSelected = comments.every((_, i) => selected.has(i));
    setSelected(allSelected ? new Set() : new Set(comments.map((_, i) => i)));
  }

  if (done !== null) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440, textAlign: "center", padding: "32px 24px" }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>✓</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
            {done} {done === 1 ? "comment" : "comments"} ingested
          </div>
          <p className="dim" style={{ marginBottom: 20 }}>
            {done === 0 ? "All comments were already in this cluster." : "Comments added to the cluster."}
          </p>
          <button className="btn btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    );
  }

  const selectedCount = comments.filter((_, i) => selected.has(i)).length;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 640, maxHeight: "90vh", display: "flex", flexDirection: "column" }}
      >
        <div className="modal-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Ingest Instagram comments</h2>
            <p className="dim" style={{ margin: "2px 0 0", fontSize: 12 }}>
              Paste the comments section. Comments will be added to this cluster.
            </p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        {/* Post URL */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: "var(--ink-50)", marginBottom: 4 }}>Post URL</div>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.instagram.com/p/…"
            style={{ width: "100%", boxSizing: "border-box", fontSize: 13, padding: "6px 10px", background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--ink-100)" }}
          />
        </div>

        {/* Paste area */}
        {comments.length === 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: "var(--ink-50)", marginBottom: 4 }}>
              Paste the comments text (copy all visible comments from Instagram):
            </div>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={8}
              placeholder="Paste Instagram comments here…"
              style={{ width: "100%", boxSizing: "border-box", fontSize: 12, padding: "8px 10px", background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--ink-100)", resize: "vertical", fontFamily: "inherit" }}
            />
            <button
              className="btn btn-ghost btn-sm"
              onClick={parsePaste}
              disabled={parsing || !pasteText.trim()}
              style={{ marginTop: 6 }}
            >
              {parsing ? "Parsing…" : "Parse comments"}
            </button>
          </div>
        )}

        {error && (
          <p style={{ fontSize: 12, color: "var(--err)", marginBottom: 8 }}>{error}</p>
        )}

        {/* Comment list */}
        {comments.length > 0 && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={{ fontSize: 12, color: "var(--ink-60)" }}>
                {comments.length} comment{comments.length !== 1 ? "s" : ""} parsed
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-ghost btn-sm" onClick={toggleAll}>
                  {comments.every((_, i) => selected.has(i)) ? "Deselect all" : "Select all"}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => { setComments([]); setSelected(new Set()); setPasteText(""); }}>
                  Re-paste
                </button>
              </div>
            </div>
            <div style={{ flex: 1, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 6, marginBottom: 12 }}>
              {comments.map((c, i) => (
                <div
                  key={i}
                  onClick={() => toggle(i)}
                  style={{
                    display: "flex",
                    gap: 10,
                    padding: "10px 12px",
                    cursor: "pointer",
                    borderBottom: i < comments.length - 1 ? "1px solid var(--border)" : "none",
                    background: selected.has(i) ? "var(--surface-2)" : "transparent",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(i)}
                    onChange={() => toggle(i)}
                    onClick={(e) => e.stopPropagation()}
                    style={{ marginTop: 2, flexShrink: 0 }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 8, marginBottom: 3, alignItems: "center" }}>
                      <span style={{ fontWeight: 600, fontSize: 12 }}>@{c.author}</span>
                      {c.timestamp && (
                        <span style={{ fontSize: 11, color: "var(--ink-40)", marginLeft: "auto" }}>{c.timestamp}</span>
                      )}
                    </div>
                    <p style={{ margin: 0, fontSize: 12, color: "var(--ink-80)", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" }}>
                      {c.body}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                className="btn btn-primary"
                onClick={submit}
                disabled={submitting || selectedCount === 0}
              >
                {submitting ? "Saving…" : `Ingest ${selectedCount} comment${selectedCount === 1 ? "" : "s"}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
