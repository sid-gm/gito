"use client";

import { useEffect, useState } from "react";
import { useAnalyst } from "@/components/analyst/AnalystContext";
import {
  platformMeta,
  topicColor,
  sentColor,
  fmtScore,
  fmtCount,
  timeAgo,
} from "@/components/analyst/data";

/* ─── API shapes ──────────────────────────────────────────────────────── */

interface ThreadRow {
  id: string;
  platform: string;
  url: string | null;
  author: string | null;
  title: string | null;
  body: string | null;
  publishedAt: string | null;
  createdAt: string;
  topicId: string | null;
  topicLabel: string | null;
  rootSentiment: number | null;
  likes: number;
  reach: number;
  replyCount: number;
  avgSentiment: string | null;
}

interface Reply {
  id: string;
  platform: string;
  url: string | null;
  author: string | null;
  title: string | null;
  body: string | null;
  publishedAt: string | null;
  createdAt: string;
  depth: number | null;
  sentimentScore: number | null;
  likes: number;
  reach: number;
}

interface Detail {
  post: ThreadRow & { sentimentScore: number | null; kind: string };
  replies: Reply[];
  replyCount: number;
  avgSentiment: number | null;
  totalLikes: number;
}

/* ─── Helpers ─────────────────────────────────────────────────────────── */

const bodyText = (i: { title: string | null; body: string | null }) =>
  [i.title, i.body].filter(Boolean).join(" — ") || "—";

function initials(name: string | null): string {
  if (!name) return "?";
  const cleaned = name.replace(/^[@]/, "").replace(/^(r|u)\//i, "");
  const parts = cleaned.split(/[\s._/-]+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((p) => p[0]);
  return (letters.join("") || cleaned.slice(0, 2) || "?").toUpperCase();
}

/* ─── Page ────────────────────────────────────────────────────────────── */

export default function GroupingPage() {
  const { companyId, days } = useAnalyst();
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [total, setTotal] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  // Track which company the open thread belongs to so switching companies
  // clears it by derivation (no synchronous setState in an effect).
  const [open, setOpen] = useState<{ id: string; companyId: string } | null>(null);
  const openId = open && open.companyId === companyId ? open.id : null;
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoadedKey, setDetailLoadedKey] = useState<string | null>(null);

  const listKey = `${companyId}|${days}`;
  const listLoading = companyId != null && loadedKey !== listKey;

  const detailKey = openId ? `${companyId}|${openId}` : null;
  const detailLoading = openId != null && detailLoadedKey !== detailKey;

  // ── Load the thread list ──
  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    const key = `${companyId}|${days}`;
    fetch(`/api/analyst/grouping?companyId=${companyId}&days=${days}&limit=40`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data) => {
        if (cancelled) return;
        setThreads(data.threads ?? []);
        setTotal(data.total ?? 0);
        setNextOffset(data.nextOffset ?? null);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadedKey(key);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, days]);

  // ── Load the open thread's detail ──
  useEffect(() => {
    if (!companyId || !openId) return;
    let cancelled = false;
    const key = `${companyId}|${openId}`;
    fetch(`/api/analyst/grouping?companyId=${companyId}&threadId=${openId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: Detail) => {
        if (!cancelled) setDetail(data);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      })
      .finally(() => {
        if (!cancelled) setDetailLoadedKey(key);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, openId]);

  async function loadMore() {
    if (!companyId || nextOffset == null) return;
    const res = await fetch(
      `/api/analyst/grouping?companyId=${companyId}&days=${days}&limit=40&offset=${nextOffset}`,
    );
    if (!res.ok) return;
    const data = await res.json();
    setThreads((prev) => [...prev, ...(data.threads ?? [])]);
    setNextOffset(data.nextOffset ?? null);
  }

  /* ─── Detail view ───────────────────────────────────────────────────── */
  if (openId) {
    const pm = detail ? platformMeta(detail.post.platform) : null;
    const post = detail?.post;
    return (
      <div className="an-grouping-detail">
        <button className="an-grouping-back" onClick={() => setOpen(null)}>
          <span aria-hidden>←</span> All groupings
        </button>

        {detailLoading ? (
          <div className="an-empty">Loading thread…</div>
        ) : !post || !pm ? (
          <div className="an-empty">This thread is no longer available.</div>
        ) : (
          <>
            <div className="an-original">
              <span
                className="an-original-accent"
                style={{ background: pm.color }}
              />
              <div className="an-original-head">
                <span
                  className="an-tag"
                  style={{ background: pm.color + "22", color: pm.color }}
                >
                  {pm.tag}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div className="an-original-author">{post.author ?? "—"}</div>
                  <div className="an-original-meta">
                    {pm.label} · {timeAgo(post.publishedAt ?? post.createdAt)}
                  </div>
                </div>
                <span className="an-original-badge">ORIGINAL</span>
              </div>
              <div className="an-original-text">
                {post.url ? (
                  <a href={post.url} target="_blank" rel="noreferrer">
                    {bodyText(post)}
                  </a>
                ) : (
                  bodyText(post)
                )}
              </div>
              <div className="an-original-metrics">
                <span>
                  <span className="an-metric-strong">{fmtCount(post.likes)}</span>{" "}
                  likes
                </span>
                <span>
                  <span className="an-metric-strong">{detail.replyCount}</span>{" "}
                  replies
                </span>
                {detail.avgSentiment != null && (
                  <span className="an-grouping-sent">
                    <span
                      className="an-sent-dot"
                      style={{ background: sentColor(detail.avgSentiment) }}
                    />
                    {fmtScore(detail.avgSentiment)}
                  </span>
                )}
              </div>
            </div>

            <div className="an-replies-head">
              <h3 className="an-replies-title">Replies</h3>
              <span className="an-replies-count">
                {detail.replyCount} · flattened to the original post
              </span>
            </div>

            <div className="an-reply-list">
              {detail.replies.map((r) => (
                <div key={r.id} className="an-reply">
                  <span className="an-reply-avatar">{initials(r.author)}</span>
                  <div className="an-reply-body">
                    <div className="an-reply-head">
                      <span className="an-reply-author">{r.author ?? "—"}</span>
                      <span className="an-reply-meta">
                        {timeAgo(r.publishedAt ?? r.createdAt)}
                      </span>
                      {r.sentimentScore != null && (
                        <span className="an-reply-sent">
                          <span
                            className="an-sent-dot"
                            style={{ background: sentColor(r.sentimentScore) }}
                          />
                          <span className="an-reply-sent-score">
                            {fmtScore(r.sentimentScore)}
                          </span>
                        </span>
                      )}
                    </div>
                    <div className="an-reply-text">
                      {r.url ? (
                        <a href={r.url} target="_blank" rel="noreferrer">
                          {bodyText(r)}
                        </a>
                      ) : (
                        bodyText(r)
                      )}
                    </div>
                    <div className="an-reply-likes">
                      <span className="an-metric-strong">{fmtCount(r.likes)}</span>{" "}
                      likes
                    </div>
                  </div>
                </div>
              ))}
              {detail.replies.length === 0 && (
                <div className="an-empty">
                  No replies collected for this post yet.
                </div>
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  /* ─── List view ─────────────────────────────────────────────────────── */
  const meta = listLoading
    ? "Loading…"
    : `${total.toLocaleString()} threads · each original post grouped with all its replies · last ${days} days`;

  return (
    <div className="an-grouping-list">
      <div className="an-grouping-meta">{meta}</div>

      {threads.map((g) => {
        const pm = platformMeta(g.platform);
        const tc = topicColor(g.topicId);
        const sent = g.avgSentiment != null ? Number(g.avgSentiment) : g.rootSentiment;
        return (
          <div
            key={g.id}
            className="an-grouping-card"
            role="button"
            tabIndex={0}
            onClick={() => companyId && setOpen({ id: g.id, companyId })}
            onKeyDown={(e) => {
              if ((e.key === "Enter" || e.key === " ") && companyId) {
                e.preventDefault();
                setOpen({ id: g.id, companyId });
              }
            }}
          >
            <span
              className="an-grouping-accent"
              style={{ background: pm.color }}
            />
            <div className="an-grouping-card-head">
              <span className="an-grouping-handle">{g.author ?? "—"}</span>
              <span className="an-grouping-time">
                · {timeAgo(g.publishedAt ?? g.createdAt)}
              </span>
              {g.topicLabel && (
                <span
                  className="an-topic-pill"
                  style={{ background: tc + "1c", color: tc }}
                >
                  {g.topicLabel}
                </span>
              )}
              <span className="an-grouping-view">
                View thread <span aria-hidden>→</span>
              </span>
            </div>
            <div className="an-grouping-text">{bodyText(g)}</div>
            <div className="an-grouping-metrics">
              <span className="an-grouping-plat">{pm.label}</span>
              <span>
                <span className="an-metric-strong">{fmtCount(g.likes)}</span> likes
              </span>
              <span>
                <span className="an-metric-strong">{g.replyCount}</span> replies
              </span>
              {sent != null && (
                <span className="an-grouping-sent">
                  <span
                    className="an-sent-dot"
                    style={{ background: sentColor(sent) }}
                  />
                  {fmtScore(sent)}
                </span>
              )}
            </div>
          </div>
        );
      })}

      {!listLoading && threads.length === 0 && (
        <div className="an-empty">
          No posts in this window yet — run the collector or add sources.
        </div>
      )}

      {nextOffset != null && (
        <button className="an-loadmore" onClick={loadMore}>
          Load more
        </button>
      )}
    </div>
  );
}
