"use client";

import { useEffect, useState } from "react";
import { PlatformChip, Field } from "@/components/primitives";
import { useCompany } from "@/components/CompanyContext";

type Entity = { id: string; label: string; entityType: string };

type ParsedComment = {
  author: string;
  body: string;
  score: number | null;
  timestamp: string | null;
};

type ParsedTweet = {
  author: string;
  displayName: string;
  body: string;
  tweetUrl: string | null;
  timestamp: string | null;
  isOriginalPost: boolean;
};

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

function isRedditUrl(url: string): boolean {
  return /^https?:\/\/(www\.)?reddit\.com\/r\//i.test(url);
}

function isXUrl(url: string): boolean {
  return /^https?:\/\/(x\.com|twitter\.com)\//i.test(url);
}

function toRedditJsonUrl(url: string): string {
  return url.replace(/\/?$/, ".json") + "?limit=500&depth=3";
}

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
    if (d.replies && typeof d.replies !== "string" && d.replies.data?.children) {
      results.push(...flattenRedditComments(d.replies.data.children));
    }
  }
  return results;
}

const emptyForm = {
  url: "",
  title: "",
  body: "",
  author: "",
  publishedAt: "",
  entityId: "none",
};

export default function SubmitPage() {
  const { activeCompanyId } = useCompany();
  const [entities, setEntities] = useState<Entity[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [fetchingMeta, setFetchingMeta] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<{ clusterId?: string } | boolean>(false);
  const [error, setError] = useState("");

  // Reddit comment panel state
  const [redditComments, setRedditComments] = useState<ParsedComment[]>([]);
  const [selectedIdxs, setSelectedIdxs] = useState<Set<number>>(new Set());
  const [fetchingComments, setFetchingComments] = useState(false);
  const [fetchCommentError, setFetchCommentError] = useState("");
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [parsingPaste, setParsingPaste] = useState(false);

  // X thread panel state
  const [xTweets, setXTweets] = useState<ParsedTweet[]>([]);
  const [selectedTweetIdxs, setSelectedTweetIdxs] = useState<Set<number>>(new Set());
  const [xPasteText, setXPasteText] = useState("");
  const [parsingXPaste, setParsingXPaste] = useState(false);

  const set = (k: keyof typeof form, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  const isReddit = isRedditUrl(form.url);
  const isX = isXUrl(form.url) && !isReddit;

  // Clear Reddit panel when URL stops being Reddit
  useEffect(() => {
    if (!isReddit) {
      setRedditComments([]);
      setSelectedIdxs(new Set());
      setFetchCommentError("");
      setPasteMode(false);
      setPasteText("");
    }
  }, [isReddit]);

  // Clear X panel when URL stops being an X URL
  useEffect(() => {
    if (!isX) {
      setXTweets([]);
      setSelectedTweetIdxs(new Set());
      setXPasteText("");
    }
  }, [isX]);

  // Auto-fill author from X/Twitter status URL
  useEffect(() => {
    if (!form.url) return;
    const match = form.url.match(/^https?:\/\/(?:x|twitter)\.com\/([^/]+)\/status\//i);
    if (match && !form.author) {
      set("author", `@${match[1]}`);
    }
  }, [form.url]);

  useEffect(() => {
    const url = activeCompanyId
      ? `/api/entities?companyId=${activeCompanyId}`
      : "/api/entities";
    fetch(url).then((r) => r.json()).then((data: Entity[]) => {
      setEntities(data);
      if (data.length === 1) {
        setForm((f) => ({ ...f, entityId: data[0].id }));
      }
    });
  }, [activeCompanyId]);

  const handleFetch = async () => {
    if (!form.url) return;
    setFetchingMeta(true);
    try {
      const res = await fetch(`/api/meta?url=${encodeURIComponent(form.url)}`);
      if (res.ok) {
        const data = await res.json();
        setForm((f) => ({
          ...f,
          title: data.title ?? f.title,
          author: data.author ?? f.author,
        }));
      }
    } catch { /* best-effort */ }
    setFetchingMeta(false);
  };

  const fetchRedditComments = async () => {
    setFetchCommentError("");
    setFetchingComments(true);
    setRedditComments([]);
    setSelectedIdxs(new Set());
    try {
      const jsonUrl = toRedditJsonUrl(form.url.trim());
      const res = await fetch(jsonUrl, { headers: { Accept: "application/json" }, credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const children: RedditChild[] = data?.[1]?.data?.children ?? [];
      const parsed = flattenRedditComments(children);
      if (parsed.length === 0) throw new Error("No comments found — try paste mode");
      setRedditComments(parsed);
      setSelectedIdxs(new Set(parsed.map((_, i) => i)));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setFetchCommentError(msg + " — try paste mode below");
      setPasteMode(true);
    } finally {
      setFetchingComments(false);
    }
  };

  const parsePaste = async () => {
    if (!pasteText.trim()) return;
    setParsingPaste(true);
    setRedditComments([]);
    setSelectedIdxs(new Set());
    try {
      const res = await fetch("/api/items/manual/parse-reddit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: pasteText }),
      });
      const data = await res.json();
      const parsed: ParsedComment[] = data.comments ?? [];
      setRedditComments(parsed);
      setSelectedIdxs(new Set(parsed.map((_, i) => i)));
    } finally {
      setParsingPaste(false);
    }
  };

  function toggleAll() {
    setSelectedIdxs(redditComments.length === selectedIdxs.size
      ? new Set()
      : new Set(redditComments.map((_, i) => i)));
  }

  function toggleIdx(i: number) {
    setSelectedIdxs((s) => {
      const next = new Set(s);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }

  const parseXPaste = async () => {
    if (!xPasteText.trim()) return;
    setParsingXPaste(true);
    setXTweets([]);
    setSelectedTweetIdxs(new Set());
    try {
      const res = await fetch("/api/items/manual/parse-x-thread", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: xPasteText }),
      });
      const data = await res.json();
      const parsed: ParsedTweet[] = data.tweets ?? [];
      setXTweets(parsed);
      setSelectedTweetIdxs(new Set(parsed.map((_, i) => i)));
    } finally {
      setParsingXPaste(false);
    }
  };

  function toggleAllTweets() {
    setSelectedTweetIdxs(xTweets.length === selectedTweetIdxs.size
      ? new Set()
      : new Set(xTweets.map((_, i) => i)));
  }

  function toggleTweetIdx(i: number) {
    setSelectedTweetIdxs((s) => {
      const next = new Set(s);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }

  const selectedComments = redditComments.filter((_, i) => selectedIdxs.has(i));
  const selectedTweets = xTweets.filter((_, i) => selectedTweetIdxs.has(i));
  const useThreadFlow = (isReddit && selectedComments.length > 0) || (isX && selectedTweets.length > 0);
  const useXThreadFlow = isX && selectedTweets.length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");

    if (useXThreadFlow) {
      // X thread → create cluster automatically
      const res = await fetch("/api/items/manual/x-thread", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadUrl: form.url,
          title: form.title,
          body: form.body || undefined,
          author: form.author || undefined,
          publishedAt: form.publishedAt || undefined,
          entityId: form.entityId !== "none" ? form.entityId : undefined,
          companyId: activeCompanyId ?? undefined,
          tweets: selectedTweets,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setDone({ clusterId: data.clusterId });
        setForm(emptyForm);
        setXTweets([]);
        setSelectedTweetIdxs(new Set());
        setXPasteText("");
      } else {
        setError("Failed to submit. Check required fields.");
      }
    } else if (useThreadFlow) {
      // Reddit thread + comments → create cluster automatically
      const res = await fetch("/api/items/manual/reddit-thread", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadUrl: form.url,
          title: form.title,
          body: form.body || undefined,
          author: form.author || undefined,
          publishedAt: form.publishedAt || undefined,
          entityId: form.entityId !== "none" ? form.entityId : undefined,
          companyId: activeCompanyId ?? undefined,
          comments: selectedComments.map((c) => ({
            author: c.author,
            body: c.body,
            score: c.score ?? undefined,
            timestamp: c.timestamp ?? undefined,
          })),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setDone({ clusterId: data.clusterId });
        setForm(emptyForm);
        setRedditComments([]);
        setSelectedIdxs(new Set());
        setPasteText("");
        setPasteMode(false);
      } else {
        setError("Failed to submit. Check required fields.");
      }
    } else {
      // Standard single-item submission
      const res = await fetch("/api/items/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          entityId: form.entityId === "none" ? undefined : form.entityId,
        }),
      });
      if (res.ok) {
        setDone(true);
        setForm(emptyForm);
      } else {
        setError("Failed to submit. Check required fields.");
      }
    }
    setSaving(false);
  };

  return (
    <>
      <header className="topbar">
        <div>
          <div className="eyebrow">Part 1 · Ingestion</div>
          <h1 className="page-title">Manual submission</h1>
          <p className="page-desc">Paste a URL or write up something the crawlers missed.</p>
        </div>
      </header>

      <div className="page">
        <div className="submit-grid" style={{ gridTemplateColumns: "1fr" }}>
          <form className="submit-form" onSubmit={handleSubmit}>
            <div className="form-stack">
              {entities.length === 0 && (
                <div className="banner" style={{ background: "oklch(0.97 0.04 80)", borderColor: "var(--warn, oklch(0.75 0.15 80))" }}>
                  <strong>No entities configured.</strong> You need at least one tracked entity before
                  submitting. <a href="/analyst/track" className="ulink">Create an entity →</a>
                </div>
              )}

              <Field
                label="URL"
                hint="Paste an article URL — we'll try to auto-fetch the title and author."
                full
              >
                <div className="ipt-wrap">
                  <input
                    className="ipt mono"
                    placeholder="https://…"
                    value={form.url}
                    onChange={(e) => set("url", e.target.value)}
                    type="url"
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
              </Field>

              {/* Reddit thread comment panel */}
              {isReddit && (
                <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "14px 14px 10px", background: "var(--surface-1)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>Reddit thread detected</div>
                      <div style={{ fontSize: 12, color: "var(--ink-60)" }}>
                        Load comments to create a tracked cluster with sentiment analysis.
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      {redditComments.length === 0 && (
                        <>
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={fetchRedditComments}
                            disabled={fetchingComments}
                          >
                            {fetchingComments ? "Fetching…" : "Load comments"}
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => setPasteMode((v) => !v)}
                          >
                            Paste text
                          </button>
                        </>
                      )}
                      {redditComments.length > 0 && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => { setRedditComments([]); setSelectedIdxs(new Set()); setPasteMode(false); setPasteText(""); }}
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>

                  {fetchCommentError && (
                    <p style={{ fontSize: 12, color: "var(--err)", marginBottom: 8 }}>{fetchCommentError}</p>
                  )}

                  {pasteMode && redditComments.length === 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <textarea
                        value={pasteText}
                        onChange={(e) => setPasteText(e.target.value)}
                        rows={6}
                        placeholder="Paste the Reddit thread comments here…"
                        style={{ width: "100%", boxSizing: "border-box", fontSize: 12, padding: "8px 10px", background: "var(--surface-0, var(--paper))", border: "1px solid var(--border)", borderRadius: 6, color: "var(--ink-100)", resize: "vertical", fontFamily: "inherit" }}
                      />
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={parsePaste}
                        disabled={parsingPaste || !pasteText.trim()}
                        style={{ marginTop: 6 }}
                      >
                        {parsingPaste ? "Parsing…" : "Parse comments"}
                      </button>
                    </div>
                  )}

                  {redditComments.length > 0 && (
                    <>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <div style={{ fontSize: 12, color: "var(--ink-60)" }}>
                          {selectedIdxs.size} of {redditComments.length} comment{redditComments.length !== 1 ? "s" : ""} selected
                        </div>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={toggleAll}>
                          {selectedIdxs.size === redditComments.length ? "Deselect all" : "Select all"}
                        </button>
                      </div>
                      <div style={{ maxHeight: 260, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 6 }}>
                        {redditComments.map((c, i) => (
                          <div
                            key={i}
                            onClick={() => toggleIdx(i)}
                            style={{
                              display: "flex",
                              gap: 10,
                              padding: "9px 12px",
                              cursor: "pointer",
                              borderBottom: i < redditComments.length - 1 ? "1px solid var(--border)" : "none",
                              background: selectedIdxs.has(i) ? "var(--surface-2)" : "transparent",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={selectedIdxs.has(i)}
                              onChange={() => toggleIdx(i)}
                              onClick={(e) => e.stopPropagation()}
                              style={{ marginTop: 2, flexShrink: 0 }}
                            />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: "flex", gap: 8, marginBottom: 2 }}>
                                <span style={{ fontWeight: 600, fontSize: 12 }}>u/{c.author}</span>
                                {c.score !== null && (
                                  <span style={{ fontSize: 11, color: "var(--ink-40)" }}>↑ {c.score}</span>
                                )}
                              </div>
                              <p style={{ margin: 0, fontSize: 12, color: "var(--ink-80)", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                                {c.body}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                      {selectedComments.length > 0 && (
                        <div style={{ marginTop: 8, fontSize: 12, color: "var(--ink-60)" }}>
                          Submitting will create a cluster with {selectedComments.length} comment{selectedComments.length !== 1 ? "s" : ""} and run sentiment analysis.
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* X thread panel */}
              {isX && (
                <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "14px 14px 10px", background: "var(--surface-1)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>X thread detected</div>
                      <div style={{ fontSize: 12, color: "var(--ink-60)" }}>
                        Paste the thread to create a tracked cluster with sentiment analysis.
                      </div>
                    </div>
                    {xTweets.length > 0 && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => { setXTweets([]); setSelectedTweetIdxs(new Set()); setXPasteText(""); }}
                      >
                        Clear
                      </button>
                    )}
                  </div>

                  {xTweets.length === 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <textarea
                        value={xPasteText}
                        onChange={(e) => setXPasteText(e.target.value)}
                        rows={6}
                        placeholder="Copy the thread from X and paste here — select all content including replies"
                        style={{ width: "100%", boxSizing: "border-box", fontSize: 12, padding: "8px 10px", background: "var(--surface-0, var(--paper))", border: "1px solid var(--border)", borderRadius: 6, color: "var(--ink-100)", resize: "vertical", fontFamily: "inherit" }}
                      />
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={parseXPaste}
                        disabled={parsingXPaste || !xPasteText.trim()}
                        style={{ marginTop: 6 }}
                      >
                        {parsingXPaste ? "Parsing…" : "Parse thread"}
                      </button>
                    </div>
                  )}

                  {xTweets.length > 0 && (
                    <>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <div style={{ fontSize: 12, color: "var(--ink-60)" }}>
                          {selectedTweetIdxs.size} of {xTweets.length} tweet{xTweets.length !== 1 ? "s" : ""} selected
                        </div>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={toggleAllTweets}>
                          {selectedTweetIdxs.size === xTweets.length ? "Deselect all" : "Select all"}
                        </button>
                      </div>
                      <div style={{ maxHeight: 260, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 6 }}>
                        {xTweets.map((t, i) => (
                          <div
                            key={i}
                            onClick={() => toggleTweetIdx(i)}
                            style={{
                              display: "flex",
                              gap: 10,
                              padding: "9px 12px",
                              cursor: "pointer",
                              borderBottom: i < xTweets.length - 1 ? "1px solid var(--border)" : "none",
                              background: selectedTweetIdxs.has(i) ? "var(--surface-2)" : "transparent",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={selectedTweetIdxs.has(i)}
                              onChange={() => toggleTweetIdx(i)}
                              onClick={(e) => e.stopPropagation()}
                              style={{ marginTop: 2, flexShrink: 0 }}
                            />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: "flex", gap: 8, marginBottom: 2 }}>
                                <span style={{ fontWeight: 600, fontSize: 12 }}>@{t.author}</span>
                                {t.isOriginalPost && (
                                  <span style={{ fontSize: 11, color: "var(--ink-40)" }}>OP</span>
                                )}
                                {t.timestamp && (
                                  <span style={{ fontSize: 11, color: "var(--ink-40)" }}>{t.timestamp}</span>
                                )}
                              </div>
                              <p style={{ margin: 0, fontSize: 12, color: "var(--ink-80)", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                                {t.body}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                      {selectedTweets.length > 0 && (
                        <div style={{ marginTop: 8, fontSize: 12, color: "var(--ink-60)" }}>
                          Submitting will create a cluster with {selectedTweets.length} tweet{selectedTweets.length !== 1 ? "s" : ""} and run sentiment analysis.
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              <Field
                label="Title"
                hint="Required. The headline you'd file this under."
                full
              >
                <input
                  className="ipt"
                  placeholder="Article or post title"
                  value={form.title}
                  onChange={(e) => set("title", e.target.value)}
                  required
                />
              </Field>

              <Field
                label="Summary / body"
                hint="Paste the key passage, or your own write-up."
                full
              >
                <textarea
                  className="ipt ipt-area"
                  rows={6}
                  placeholder="Paste the key content or write a summary…"
                  value={form.body}
                  onChange={(e) => set("body", e.target.value)}
                />
              </Field>

              <div className="form-row">
                <Field label="Author / handle" hint="Byline or @handle">
                  <input
                    className="ipt"
                    placeholder="@author or Author Name"
                    value={form.author}
                    onChange={(e) => set("author", e.target.value)}
                  />
                </Field>
                <Field label="Published date" hint="ISO date">
                  <input
                    className="ipt mono"
                    type="date"
                    value={form.publishedAt}
                    onChange={(e) => set("publishedAt", e.target.value)}
                  />
                </Field>
              </div>

              <Field
                label="Link to tracked entity"
                hint="Required. Routes this item into that entity's stream."
                full
              >
                <select
                  className="ipt"
                  value={form.entityId}
                  onChange={(e) => set("entityId", e.target.value)}
                  style={form.entityId === "none" ? { borderColor: "var(--err)" } : undefined}
                >
                  <option value="none">— Select entity (required) —</option>
                  {entities.map((e) => (
                    <option key={e.id} value={e.id}>{e.label}</option>
                  ))}
                </select>
              </Field>

              <div className="form-foot">
                <div className="form-foot-meta">
                  <PlatformChip platform="manual" />
                  <span className="dim">
                    {useXThreadFlow
                      ? `Will create cluster with ${selectedTweets.length} tweet${selectedTweets.length !== 1 ? "s" : ""}`
                      : useThreadFlow
                        ? `Will create cluster with ${selectedComments.length} comment${selectedComments.length !== 1 ? "s" : ""}`
                        : "Will appear in feed tagged Manual"}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      setForm(emptyForm);
                      setDone(false);
                      setRedditComments([]);
                      setSelectedIdxs(new Set());
                      setPasteText("");
                      setPasteMode(false);
                      setXTweets([]);
                      setSelectedTweetIdxs(new Set());
                      setXPasteText("");
                    }}
                  >
                    Clear
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={saving || entities.length === 0 || form.entityId === "none"}>
                    {saving
                      ? "Submitting…"
                      : useThreadFlow || useXThreadFlow
                        ? "Submit + create cluster"
                        : "Submit to feed"}
                  </button>
                </div>
              </div>

              {done && typeof done === "object" && done.clusterId && (
                <div className="banner banner-ok">
                  <span style={{ fontSize: 12 }}>✓</span>
                  Saved and cluster created.{" "}
                  <a href="/analyst/clusters" className="ulink">View in clusters →</a>
                </div>
              )}
              {done === true && (
                <div className="banner banner-ok">
                  <span style={{ fontSize: 12 }}>✓</span>
                  Saved.{" "}
                  <a href="/analyst" className="ulink">View in feed →</a>
                </div>
              )}
              {error && (
                <div className="banner" style={{ background: "oklch(0.96 0.05 25)", color: "var(--err)", border: "1px solid oklch(0.86 0.10 25)" }}>
                  {error}
                </div>
              )}
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
