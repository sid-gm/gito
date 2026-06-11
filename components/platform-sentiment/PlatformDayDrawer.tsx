"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { cx } from "@/components/primitives";
import {
  NtlFeed, NtlDay, NtlDayItem, SelectedDayState,
  fmtFullDate, fmtScore, sentSlug, SentPill,
} from "@/components/news-timeline/timeline_core";

type PlatformCluster = {
  id: string;
  label: string | null;
  sentimentScore: number | null;
  sentimentLabel: string | null;
  itemCount: number;
  dayAvgScore: number | null;
  dayScoredCount: number;
};

type DayBreakdown = {
  total: number;
  scored: number;
  pos: number;
  neg: number;
};

const PLATFORM_LABELS: Record<string, string> = {
  reddit: "Reddit",
  twitter: "Twitter / X",
  hackernews: "Hacker News",
  threads: "Threads",
  instagram: "Instagram",
  facebook: "Facebook",
  google_alerts: "News",
  manual: "Manual",
};

const ROOT_POST_SUBTYPES = new Set([
  "reddit_post", "reddit_thread", "x_post", "ig_post", "threads_post", "story", "facebook_post",
]);

function isRootPost(subtype: string | null | undefined): boolean {
  return subtype != null && ROOT_POST_SUBTYPES.has(subtype);
}

function ItemCard({ item }: { item: NtlDayItem }) {
  const domain = item.url
    ? (() => { try { return new URL(item.url!).hostname.replace(/^www\./, ""); } catch { return ""; } })()
    : "";
  const time = item.publishedAt
    ? new Date(item.publishedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "";
  const score = item.sentimentScore ?? null;
  const scoreSlug = score == null ? "neutral" : sentSlug(item.sentimentLabel ?? null);

  function inner() {
    return (
      <>
        <div className="ntl-story-top">
          {item.author && <span className="ntl-story-src">{item.author}</span>}
          {time && <span className="ntl-story-time">{time}</span>}
          {score != null && (
            <span className={cx("ntl-story-time", `nd-text-${scoreSlug}`)} title={item.sentimentLabel ?? undefined}>
              {fmtScore(score)}
            </span>
          )}
        </div>
        <div className="ntl-story-title">{item.title ?? "(no title)"}</div>
        {item.body && (
          <div className="ntl-story-snip">
            {item.body.slice(0, 180)}{item.body.length > 180 ? "…" : ""}
          </div>
        )}
        <div className="ntl-story-foot">
          {domain && <span className="ntl-story-dom">{domain}</span>}
          {(item.replyCount ?? 0) > 0 && (
            <span className="ntl-story-dom">
              {isRootPost(item.subtype)
                ? `${item.replyCount} ${item.replyCount === 1 ? "reply" : "replies"} ingested`
                : `thread · ${(item.replyCount ?? 0) + 1} items`}
            </span>
          )}
          {item.url && <span className="ntl-story-go" aria-hidden="true">↗</span>}
        </div>
      </>
    );
  }

  return item.url
    ? <a className="ntl-story" href={item.url} target="_blank" rel="noopener noreferrer">{inner()}</a>
    : <div className="ntl-story">{inner()}</div>;
}

export function PlatformDayDrawer({
  selected,
  onClose,
  companyId,
}: {
  selected: SelectedDayState;
  onClose: () => void;
  companyId: string;
}) {
  const [last, setLast] = useState<{ feed: NtlFeed; day: NtlDay } | null>(null);
  const [drawerClusters, setDrawerClusters] = useState<PlatformCluster[]>([]);
  const [items, setItems] = useState<NtlDayItem[]>([]);
  const [breakdown, setBreakdown] = useState<DayBreakdown | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (selected) setLast(selected);
  }, [selected]);

  useEffect(() => {
    if (!selected || !companyId) return;
    const { feed, day } = selected;
    setLoading(true);
    setDrawerClusters([]);
    setItems([]);
    setBreakdown(null);
    const params = new URLSearchParams({ companyId, platform: feed.feedId, date: day.date });
    fetch(`/api/platform-sentiment-timeline/day-items?${params}`)
      .then((r) => r.json())
      .then((d) => {
        setDrawerClusters(d.clusters ?? []);
        setItems(d.items ?? []);
        setBreakdown(d.breakdown ?? null);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [selected?.feed.feedId, selected?.day.date, companyId]);

  const open = !!selected;
  const sel = selected ?? last;
  if (!sel) return null;

  const { feed, day } = sel;
  const slug = day.sentimentScore == null ? "neutral" : sentSlug(day.sentimentLabel);
  const present = day.sentimentScore != null || (day.itemCount ?? 0) > 0;

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

  const platformLabel = PLATFORM_LABELS[feed.feedId] ?? feed.feedLabel;

  return (
    <div className={cx("ntl-dw", open && "ntl-dw-open")} role="dialog" aria-label="Platform day detail">
      <div className="ntl-dw-head">
        <div className="ntl-dw-bar">
          <span className="ntl-dw-eyebrow">
            <span className="ntl-dw-glyph">◉</span> Platform Sentiment · day detail
          </span>
          <button className="ntl-dw-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="ntl-dw-date">{fmtFullDate(day.date)}</div>
        <div className="ntl-dw-feed">
          <span className="ntl-dw-feedlabel">{platformLabel}</span>
        </div>
      </div>

      <div className="ntl-dw-body">
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

        {breakdown != null && breakdown.scored > 0 && (
          <div className="ntl-dw-vol">
            <span className="nd-text-positive"><strong>{breakdown.pos}</strong> positive</span>
            {" · "}
            <span className="nd-text-negative"><strong>{breakdown.neg}</strong> negative</span>
            {" · "}
            <span><strong>{breakdown.scored - breakdown.pos - breakdown.neg}</strong> neutral</span>
            {breakdown.scored < breakdown.total && (
              <span className="ntl-dw-vol-delta">{breakdown.total - breakdown.scored} unscored</span>
            )}
          </div>
        )}

        {!present && (
          <div className="ntl-dw-block">
            <p className="ntl-dw-summary ntl-dw-empty">No items ingested for {platformLabel} this day.</p>
          </div>
        )}

        {present && drawerClusters.length > 0 && (
          <div className="ntl-dw-block">
            <div className="ntl-dw-label">
              Clusters · {drawerClusters.length} · strongest pull first
            </div>
            <div className="ntl-clusters">
              {drawerClusters.map((c) => (
                <Link
                  key={c.id}
                  href={`/analyst/clusters/${c.id}`}
                  className="ntl-cluster ntl-cluster-link"
                >
                  <div className="ntl-cluster-head">
                    <span className="ntl-cluster-topic">{c.label ?? "(unlabelled)"}</span>
                    {c.dayScoredCount > 0 && c.dayAvgScore != null ? (
                      <span
                        className={cx(
                          "ntl-cluster-count",
                          `nd-text-${c.dayAvgScore >= 0.2 ? "positive" : c.dayAvgScore <= -0.2 ? "negative" : "neutral"}`
                        )}
                        title="Average sentiment of this cluster's items on this day"
                      >
                        {fmtScore(c.dayAvgScore)} today
                      </span>
                    ) : (
                      <SentPill label={c.sentimentLabel} />
                    )}
                    <span className="ntl-cluster-count">
                      {c.itemCount} {c.itemCount === 1 ? "item" : "items"}
                    </span>
                    <span className="ntl-cluster-go">↗</span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {present && !loading && items.length > 0 && (
          <div className="ntl-dw-block">
            <div className="ntl-dw-label">
              Items · {items.length}{(breakdown?.scored ?? 0) > 0 ? " · strongest sentiment first" : ""}
            </div>
            <div className="ntl-stories">
              {items.map((it) => <ItemCard key={it.id} item={it} />)}
            </div>
          </div>
        )}

        {present && !loading && drawerClusters.length === 0 && items.length === 0 && (
          <div className="ntl-dw-block">
            <p className="ntl-dw-summary ntl-dw-empty">No clusters or items found for this day.</p>
          </div>
        )}

        <p className="ntl-dw-foot">
          Platform-level sentiment · averaged from per-item sentiment scores for {platformLabel} items
          (cluster averages where items are unscored). Reply counts reflect replies ingested by Gito, not
          total platform engagement.
        </p>
      </div>
    </div>
  );
}
