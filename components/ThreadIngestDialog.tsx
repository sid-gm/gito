"use client";

import { useState, useEffect } from "react";
import { cx } from "@/components/primitives";

type ParsedComment = {
  author: string;
  body: string;
  score: number | null;
  timestamp: string | null;
};

type Entity = { id: string; label: string };

interface Props {
  companyId: string;
  entities: Entity[];
  onClose: () => void;
  onInserted: (count: number) => void;
  defaultUrl?: string;
}

function isRedditUrl(url: string): boolean {
  return /^https?:\/\/(www\.)?reddit\.com\/r\//i.test(url);
}

function toRedditJsonUrl(url: string): string {
  return url.replace(/\/?$/, ".json") + "?limit=500&depth=3";
}

type RedditChild = {
  kind: string;
  data: {
    author?: string;
    body?: string;
    score?: number;
    created_utc?: number;
    replies?: { data?: { children?: RedditChild[] } } | string;
  };
};

function flattenRedditComments(children: RedditChild[]): ParsedComment[] {
  const results: ParsedComment[] = [];
  for (const child of children) {
    if (child.kind !== "t1") continue;
    const d = child.data;
    if (!d.body || d.body === "[deleted]" || d.body === "[removed]") continue;
    results.push({
      author: d.author ?? "[deleted]",
      body: d.body,
      score: d.score ?? null,
      timestamp: d.created_utc ? new Date(d.created_utc * 1000).toISOString() : null,
    });
    // Recurse into replies
    if (d.replies && typeof d.replies !== "string" && d.replies.data?.children) {
      results.push(...flattenRedditComments(d.replies.data.children));
    }
  }
  return results;
}

export default function ThreadIngestDialog({ companyId, entities, onClose, onInserted, defaultUrl }: Props) {
  const [url, setUrl] = useState(defaultUrl ?? "");
  const [comments, setComments] = useState<ParsedComment[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [entityId, setEntityId] = useState("");
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState("");
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<number | null>(null);

  useEffect(() => {
    if (defaultUrl && isRedditUrl(defaultUrl)) {
      fetchRedditComments();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchRedditComments() {
    setFetchError("");
    setFetching(true);
    setComments([]);
    setSelected(new Set());
    try {
      const jsonUrl = toRedditJsonUrl(url.trim());
      const res = await fetch(jsonUrl, {
        headers: { Accept: "application/json" },
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const children: RedditChild[] = data?.[1]?.data?.children ?? [];
      const parsed = flattenRedditComments(children);
      if (parsed.length === 0) throw new Error("No comments found — try paste mode");
      setComments(parsed);
      setSelected(new Set(parsed.map((_, i) => i)));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setFetchError(msg + " — try paste mode below");
      setPasteMode(true);
    } finally {
      setFetching(false);
    }
  }

  async function parsePaste() {
    if (!pasteText.trim()) return;
    setParsing(true);
    setComments([]);
    setSelected(new Set());
    try {
      const res = await fetch("/api/items/manual/parse-reddit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: pasteText }),
      });
      const data = await res.json();
      const parsed: ParsedComment[] = data.comments ?? [];
      setComments(parsed);
      setSelected(new Set(parsed.map((_, i) => i)));
    } finally {
      setParsing(false);
    }
  }

  async function submit() {
    const picked = comments.filter((_, i) => selected.has(i));
    if (picked.length === 0) return;
    setSubmitting(true);
    try {
      const threadUrl = url.trim() || undefined;
      const items = picked.map((c, i) => ({
        title: `${c.author}: ${c.body.slice(0, 80)}${c.body.length > 80 ? "…" : ""}`,
        body: c.body,
        author: c.author,
        url: threadUrl,
        publishedAt: c.timestamp ?? undefined,
        score: c.score ?? undefined,
        subtype: "reddit_comment",
        externalId: threadUrl ? `${threadUrl}#comment-${i}-${c.author}` : undefined,
      }));
      const res = await fetch("/api/items/manual/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items,
          entityId: entityId || undefined,
          companyId,
          matchEntities: !entityId,
        }),
      });
      const data = await res.json();
      setDone(data.inserted ?? 0);
      onInserted(data.inserted ?? 0);
    } finally {
      setSubmitting(false);
    }
  }

  function toggleAll() {
    if (selected.size === comments.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(comments.map((_, i) => i)));
    }
  }

  function toggle(i: number) {
    setSelected((s) => {
      const next = new Set(s);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }

  if (done !== null) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440, textAlign: "center", padding: "32px 24px" }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>✓</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
            {done} comment{done !== 1 ? "s" : ""} ingested
          </div>
          <p className="dim" style={{ marginBottom: 20 }}>
            Items are queued for embedding and will appear in feeds shortly.
          </p>
          <button className="btn btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 640, maxHeight: "90vh", display: "flex", flexDirection: "column" }}
      >
        <div className="modal-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Ingest thread</h2>
            <p className="dim" style={{ margin: 0, fontSize: 12 }}>Paste a Reddit URL to import comments automatically, or paste raw comment text.</p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        {/* URL row */}
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://reddit.com/r/…"
            onKeyDown={(e) => e.key === "Enter" && isRedditUrl(url) && fetchRedditComments()}
            style={{ flex: 1, fontSize: 13, padding: "6px 10px", background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--ink-100)" }}
          />
          {isRedditUrl(url) && (
            <button
              className="btn btn-primary btn-sm"
              onClick={fetchRedditComments}
              disabled={fetching}
            >
              {fetching ? "Fetching…" : "Fetch comments"}
            </button>
          )}
          {!isRedditUrl(url) && url && (
            <button className="btn btn-ghost btn-sm" onClick={() => setPasteMode(true)}>
              Paste text
            </button>
          )}
        </div>

        {fetchError && (
          <p style={{ fontSize: 12, color: "var(--err)", marginBottom: 8 }}>{fetchError}</p>
        )}

        {/* Paste fallback */}
        {(pasteMode || (!isRedditUrl(url) && !url)) && comments.length === 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: "var(--ink-60)", marginBottom: 4 }}>
              Paste raw Reddit comment text:
            </div>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={8}
              placeholder="Paste the Reddit thread comments here…"
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

        {/* Comment preview */}
        {comments.length > 0 && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={{ fontSize: 12, color: "var(--ink-60)" }}>
                {comments.length} comment{comments.length !== 1 ? "s" : ""} found
              </div>
              <button className="btn btn-ghost btn-sm" onClick={toggleAll}>
                {selected.size === comments.length ? "Deselect all" : "Select all"}
              </button>
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
                    <div style={{ display: "flex", gap: 8, marginBottom: 3 }}>
                      <span style={{ fontWeight: 600, fontSize: 12 }}>u/{c.author}</span>
                      {c.score !== null && (
                        <span style={{ fontSize: 11, color: "var(--ink-40)" }}>↑ {c.score}</span>
                      )}
                      {c.timestamp && (
                        <span style={{ fontSize: 11, color: "var(--ink-40)" }}>
                          {new Date(c.timestamp).toLocaleString()}
                        </span>
                      )}
                    </div>
                    <p style={{ margin: 0, fontSize: 12, color: "var(--ink-80)", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" }}>
                      {c.body}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Entity selector + submit */}
        {comments.length > 0 && (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
              style={{ flex: 1, fontSize: 12, padding: "6px 8px", background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--ink-100)" }}
            >
              <option value="">Auto-match entity by keyword</option>
              {entities.map((e) => (
                <option key={e.id} value={e.id}>{e.label}</option>
              ))}
            </select>
            <button
              className="btn btn-primary"
              onClick={submit}
              disabled={submitting || selected.size === 0}
            >
              {submitting ? "Saving…" : `Ingest ${selected.size} comment${selected.size !== 1 ? "s" : ""}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
