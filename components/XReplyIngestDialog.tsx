"use client";

import { useState } from "react";

type ParsedTweet = {
  author: string;
  displayName: string;
  body: string;
  tweetUrl: string | null;
  timestamp: string | null;
  isOriginalPost: boolean;
};

interface Props {
  clusterId: string;
  threadUrl: string;
  entityId: string | null;
  onClose: () => void;
  onInserted: (count: number) => void;
}

export default function XReplyIngestDialog({ clusterId, threadUrl, onClose, onInserted }: Props) {
  const [url, setUrl] = useState(threadUrl);
  const [pasteText, setPasteText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [tweets, setTweets] = useState<ParsedTweet[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [error, setError] = useState("");

  async function parsePaste() {
    if (!pasteText.trim()) return;
    setParsing(true);
    setTweets([]);
    setSelected(new Set());
    setError("");
    try {
      const res = await fetch("/api/items/manual/parse-x-thread", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: pasteText }),
      });
      const data = await res.json();
      const parsed: ParsedTweet[] = data.tweets ?? [];
      setTweets(parsed);
      // Pre-select only replies, not the OP (already imported)
      setSelected(new Set(parsed.map((t, i) => (!t.isOriginalPost ? i : -1)).filter((i) => i >= 0)));
    } catch {
      setError("Failed to parse — check the pasted text and try again.");
    } finally {
      setParsing(false);
    }
  }

  async function submit() {
    const picked = tweets.filter((_, i) => selected.has(i));
    if (picked.length === 0) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch(`/api/clusters/${clusterId}/ingest-x-replies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tweets: picked, threadUrl: url.trim() || threadUrl }),
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
    const replyIndices = tweets.map((t, i) => (!t.isOriginalPost ? i : -1)).filter((i) => i >= 0);
    const allSelected = replyIndices.every((i) => selected.has(i));
    setSelected(allSelected ? new Set() : new Set(replyIndices));
  }

  if (done !== null) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440, textAlign: "center", padding: "32px 24px" }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>✓</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
            {done} {done === 1 ? "reply" : "replies"} ingested
          </div>
          <p className="dim" style={{ marginBottom: 20 }}>
            {done === 0 ? "All replies were already in this cluster." : "Replies added to the cluster."}
          </p>
          <button className="btn btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    );
  }

  const replyCount = tweets.filter((_, i) => selected.has(i)).length;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 640, maxHeight: "90vh", display: "flex", flexDirection: "column" }}
      >
        <div className="modal-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Ingest X replies</h2>
            <p className="dim" style={{ margin: "2px 0 0", fontSize: 12 }}>
              Paste the full thread (OP + replies). Replies will be added to this cluster.
            </p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        {/* Thread URL */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: "var(--ink-50)", marginBottom: 4 }}>Thread URL</div>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://x.com/…"
            style={{ width: "100%", boxSizing: "border-box", fontSize: 13, padding: "6px 10px", background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--ink-100)" }}
          />
        </div>

        {/* Paste area */}
        {tweets.length === 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: "var(--ink-50)", marginBottom: 4 }}>
              Paste the full thread text (from X — copy all visible tweets):
            </div>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={8}
              placeholder="Paste X thread text here…"
              style={{ width: "100%", boxSizing: "border-box", fontSize: 12, padding: "8px 10px", background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--ink-100)", resize: "vertical", fontFamily: "inherit" }}
            />
            <button
              className="btn btn-ghost btn-sm"
              onClick={parsePaste}
              disabled={parsing || !pasteText.trim()}
              style={{ marginTop: 6 }}
            >
              {parsing ? "Parsing…" : "Parse thread"}
            </button>
          </div>
        )}

        {error && (
          <p style={{ fontSize: 12, color: "var(--err)", marginBottom: 8 }}>{error}</p>
        )}

        {/* Tweet list */}
        {tweets.length > 0 && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={{ fontSize: 12, color: "var(--ink-60)" }}>
                {tweets.length} tweet{tweets.length !== 1 ? "s" : ""} parsed
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-ghost btn-sm" onClick={toggleAll}>
                  {tweets.filter((_, i) => !tweets[i].isOriginalPost && selected.has(i)).length === tweets.filter((t) => !t.isOriginalPost).length ? "Deselect replies" : "Select replies"}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => { setTweets([]); setSelected(new Set()); setPasteText(""); }}>
                  Re-paste
                </button>
              </div>
            </div>
            <div style={{ flex: 1, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 6, marginBottom: 12 }}>
              {tweets.map((t, i) => {
                const isOp = t.isOriginalPost;
                return (
                  <div
                    key={i}
                    onClick={() => !isOp && toggle(i)}
                    style={{
                      display: "flex",
                      gap: 10,
                      padding: "10px 12px",
                      cursor: isOp ? "default" : "pointer",
                      borderBottom: i < tweets.length - 1 ? "1px solid var(--border)" : "none",
                      background: isOp ? "color-mix(in oklch, var(--ink) 3%, var(--paper))" : selected.has(i) ? "var(--surface-2)" : "transparent",
                      opacity: isOp ? 0.55 : 1,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={!isOp && selected.has(i)}
                      disabled={isOp}
                      onChange={() => !isOp && toggle(i)}
                      onClick={(e) => e.stopPropagation()}
                      style={{ marginTop: 2, flexShrink: 0 }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", gap: 8, marginBottom: 3, alignItems: "center" }}>
                        <span style={{ fontWeight: 600, fontSize: 12 }}>@{t.author}</span>
                        {t.displayName && t.displayName !== t.author && (
                          <span style={{ fontSize: 11, color: "var(--ink-50)" }}>{t.displayName}</span>
                        )}
                        {isOp && (
                          <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--ink-40)", border: "1px solid var(--border)", borderRadius: 3, padding: "1px 5px" }}>OP — already imported</span>
                        )}
                        {t.timestamp && (
                          <span style={{ fontSize: 11, color: "var(--ink-40)", marginLeft: "auto" }}>{t.timestamp}</span>
                        )}
                      </div>
                      <p style={{ margin: 0, fontSize: 12, color: "var(--ink-80)", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" }}>
                        {t.body}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                className="btn btn-primary"
                onClick={submit}
                disabled={submitting || replyCount === 0}
              >
                {submitting ? "Saving…" : `Ingest ${replyCount} repl${replyCount === 1 ? "y" : "ies"}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
