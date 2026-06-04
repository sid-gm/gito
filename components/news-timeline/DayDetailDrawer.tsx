"use client";

import React, { useEffect, useState } from "react";
import { cx, EntityBadge } from "@/components/primitives";
import {
  NtlFeed, NtlDay, NtlStory, NtlDayItem, SelectedDayState,
  fmtFullDate, fmtScore, sentSlug, ntlParseDate, SentPill,
} from "./timeline_core";

// ── Sentiment mix bar ──────────────────────────────────────────────────────
function MixBar({ stories }: { stories: NtlStory[] }) {
  const dist: Record<string, number> = {};
  for (const s of stories) {
    const key = sentSlug(s.sentiment);
    dist[key] = (dist[key] ?? 0) + s.count;
  }
  const total = Object.values(dist).reduce((a, v) => a + v, 0);
  if (!total) return null;
  const order = ["positive", "neutral", "mixed", "negative"] as const;
  return (
    <div className="ntl-mix">
      <div className="ntl-mix-bar">
        {order.map((k) => {
          const v = dist[k] ?? 0;
          if (!v) return null;
          return <span key={k} className={`ntl-mix-seg ntl-mix-${k}`} style={{ flexGrow: v }} title={`${v} ${k}`} />;
        })}
      </div>
      <div className="ntl-mix-legend">
        {order.map((k) => {
          const v = dist[k] ?? 0;
          if (!v) return null;
          return (
            <span key={k} className="ntl-mix-leg">
              <span className={`ntl-legend-dot ntl-mix-${k}`} />
              {v} {k}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ── Item card ──────────────────────────────────────────────────────────────
function ItemCard({ item }: { item: NtlDayItem }) {
  const domain = item.url ? (() => { try { return new URL(item.url!).hostname.replace(/^www\./, ""); } catch { return ""; } })() : "";
  const time = item.publishedAt
    ? new Date(item.publishedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "";
  const content = item.url
    ? <a className="ntl-story" href={item.url} target="_blank" rel="noopener noreferrer">{inner()}</a>
    : <div className="ntl-story">{inner()}</div>;

  function inner() {
    return (
      <>
        <div className="ntl-story-top">
          {item.author && <span className="ntl-story-src">{item.author}</span>}
          {time && <span className="ntl-story-time">{time}</span>}
        </div>
        <div className="ntl-story-title">{item.title ?? "(no title)"}</div>
        {item.body && <div className="ntl-story-snip">{item.body.slice(0, 180)}{item.body.length > 180 ? "…" : ""}</div>}
        <div className="ntl-story-foot">
          {domain && <span className="ntl-story-dom">{domain}</span>}
          {item.url && <span className="ntl-story-go" aria-hidden="true">↗</span>}
        </div>
      </>
    );
  }

  return content;
}

// ── Topic cluster block ────────────────────────────────────────────────────
function ClusterBlock({ story }: { story: NtlStory }) {
  return (
    <div className="ntl-cluster">
      <div className="ntl-cluster-head">
        <span className="ntl-cluster-topic">{story.label}</span>
        <SentPill label={story.sentiment} />
        <span className="ntl-cluster-count">{story.count} {story.count === 1 ? "item" : "items"}</span>
      </div>
      <p className="ntl-cluster-summary">{story.summary}</p>
    </div>
  );
}

// ── Main drawer ────────────────────────────────────────────────────────────
export function DayDetailDrawer({ selected, onClose, source = "news" }: {
  selected: SelectedDayState;
  onClose: () => void;
  source?: "news" | "social";
}) {
  const [last, setLast] = useState<{ feed: NtlFeed; day: NtlDay } | null>(null);
  const [items, setItems] = useState<NtlDayItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);

  useEffect(() => {
    if (selected) setLast(selected);
  }, [selected]);

  useEffect(() => {
    if (!selected) return;
    const { feed, day } = selected;

    if (source === "news") {
      // check if within 7-day retention window
      const today = new Date();
      const p = ntlParseDate(day.date);
      const ageDays = Math.round(
        (Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) -
          Date.UTC(p.y, p.m, p.d)) / 86400000
      );
      if (ageDays > 7) { setItems([]); return; }

      setLoadingItems(true);
      const params = new URLSearchParams({ feedId: feed.feedId, date: day.date });
      fetch(`/api/news-timeline/day-items?${params}`)
        .then((r) => r.json())
        .then((d) => { setItems(d.items ?? []); setLoadingItems(false); })
        .catch(() => setLoadingItems(false));
    } else {
      setLoadingItems(true);
      const params = new URLSearchParams({ entityId: feed.feedId, date: day.date });
      fetch(`/api/social-timeline/day-items?${params}`)
        .then((r) => r.json())
        .then((d) => { setItems(d.items ?? []); setLoadingItems(false); })
        .catch(() => setLoadingItems(false));
    }
  }, [selected?.feed.feedId, selected?.day.date, source]);

  const open = !!selected;
  const sel = selected ?? last;
  if (!sel) return null;

  const { feed, day } = sel;
  const slug = day.sentimentScore == null ? "neutral" : sentSlug(day.sentimentLabel);
  const present = day.sentimentScore != null;

  // prev-day trend
  const idx = feed.days.findIndex((d) => d.date === day.date);
  const prevDay = idx > 0 ? feed.days[idx - 1] : null;
  const trendVsPrev =
    present && prevDay?.sentimentScore != null
      ? day.sentimentScore! - prevDay.sentimentScore
      : null;
  const volumeDelta =
    prevDay != null ? (day.itemCount ?? 0) - (prevDay.itemCount ?? 0) : null;
  const trendCls =
    trendVsPrev == null ? "ntl-trend-flat"
    : trendVsPrev > 0.02 ? "ntl-trend-up"
    : trendVsPrev < -0.02 ? "ntl-trend-down"
    : "ntl-trend-flat";
  const trendGlyph =
    trendVsPrev == null ? "▬" : trendVsPrev > 0.02 ? "▲" : trendVsPrev < -0.02 ? "▼" : "▬";

  // purge check (news only — social items are not purged)
  const today = new Date();
  const p = ntlParseDate(day.date);
  const ageDays = Math.round(
    (Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) -
      Date.UTC(p.y, p.m, p.d)) / 86400000
  );
  const purged = source === "news" && ageDays > 7;

  const stories = day.stories ?? [];
  const multiTopic = stories.length > 1;
  const totalItems = present ? (day.itemCount ?? 0) : 0;

  return (
    <div className={cx("ntl-dw", open && "ntl-dw-open")} role="dialog" aria-label="Day detail">
      <div className="ntl-dw-head">
        <div className="ntl-dw-bar">
          <span className="ntl-dw-eyebrow">
            <span className="ntl-dw-glyph">◈</span> {source === "social" ? "Social · day detail" : "Google Alerts · day detail"}
          </span>
          <button className="ntl-dw-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="ntl-dw-date">{fmtFullDate(day.date)}</div>
        <div className="ntl-dw-feed">
          <EntityBadge label={feed.entityLabel} type={feed.entityType} />
          <span className="ntl-dw-feedlabel">{feed.feedLabel} feed</span>
        </div>
      </div>

      <div className="ntl-dw-body">
        {/* score block */}
        <div className="ntl-dw-score-row">
          <span className={cx("ntl-dw-score", `nd-text-${slug}`)}>
            {present ? fmtScore(day.sentimentScore) : "—"}
          </span>
          <div className="ntl-dw-score-side">
            <SentPill label={present ? day.sentimentLabel : null} />
            {trendVsPrev != null && (
              <span className={cx("ntl-dw-trend", trendCls)}>
                <span style={{ fontSize: 8 }}>{trendGlyph}</span>
                {trendVsPrev > 0 ? "+" : trendVsPrev < 0 ? "−" : ""}
                {Math.abs(trendVsPrev).toFixed(2)} vs prev day
              </span>
            )}
          </div>
        </div>
        <div className="ntl-dw-vol">
          <strong>{day.itemCount ?? 0}</strong> {(day.itemCount ?? 0) === 1 ? "item" : "items"}
          {volumeDelta != null && (
            <span className="ntl-dw-vol-delta">
              {volumeDelta > 0 ? `▲ +${volumeDelta}` : volumeDelta < 0 ? `▼ ${volumeDelta}` : "▬ flat"} vs prev day
            </span>
          )}
        </div>

        {/* summary */}
        <div className="ntl-dw-block">
          <div className="ntl-dw-label">What happened</div>
          {present
            ? day.aiSummary
              ? <p className="ntl-dw-summary">{day.aiSummary}</p>
              : <p className="ntl-dw-summary ntl-dw-empty">{source === "social" ? "No AI summary available for social activity." : "No summary available."}</p>
            : <p className="ntl-dw-summary ntl-dw-empty">{source === "social" ? "No social items were ingested this day." : "No Google Alerts items were ingested this day."}</p>}
        </div>

        {present && (
          <>
            {/* sentiment mix */}
            {stories.length > 0 && (
              <div className="ntl-dw-block">
                <div className="ntl-dw-label">
                  Sentiment mix · {totalItems} {totalItems === 1 ? "item" : "items"}
                </div>
                <MixBar stories={stories} />
              </div>
            )}

            {/* coverage */}
            <div className="ntl-dw-block">
              <div className="ntl-dw-label">
                Coverage · {totalItems} {totalItems === 1 ? "item" : "items"}
                {multiTopic ? ` · ${stories.length} topics` : ""}
              </div>

              {multiTopic && (
                <div className="ntl-clusters">
                  {stories.map((s, i) => <ClusterBlock key={i} story={s} />)}
                </div>
              )}

              {!purged && !loadingItems && items.length > 0 && (
                <div className="ntl-stories" style={multiTopic ? { marginTop: 12 } : undefined}>
                  {items.map((it) => <ItemCard key={it.id} item={it} />)}
                </div>
              )}

              {!purged && !loadingItems && items.length === 0 && !multiTopic && (
                <p className="ntl-dw-summary ntl-dw-empty">No raw articles found for this day.</p>
              )}

              {purged && (
                <div className="ntl-purged">
                  <span className="ntl-purged-glyph">⦸</span>
                  <div>
                    <div className="ntl-purged-title">Raw articles purged</div>
                    <div className="ntl-purged-sub">
                      This day is {ageDays} days old. Source articles are retained for 7 days; the
                      summaries, sentiment, and topic clusters above are kept indefinitely.
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        <p className="ntl-dw-foot">
          {source === "social"
            ? "Social conversation data · Reddit, X, HN, Threads · cluster sentiment where available."
            : "Read-only news context · summarized from Google Alerts · no clustering or signal/noise marking applied."}
        </p>
      </div>
    </div>
  );
}
