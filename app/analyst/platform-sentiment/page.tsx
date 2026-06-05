"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { cx } from "@/components/primitives";
import { useCompany } from "@/components/CompanyContext";
import { NewsTimeline } from "@/components/news-timeline/TimelineTrack";
import { PlatformDayDrawer } from "@/components/platform-sentiment/PlatformDayDrawer";
import { HoverPop } from "@/components/news-timeline/timeline_core";
import type {
  HoverPopState,
  NtlDay,
  NtlFeed,
  NtlTimelineData,
  SelectedDayState,
  WindowKey,
} from "@/components/news-timeline/timeline_core";

const WIN_OPTS: { key: WindowKey; label: string }[] = [
  { key: "7d",  label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
];

export default function PlatformSentimentPage() {
  const { activeCompanyId } = useCompany();

  const [data, setData] = useState<NtlTimelineData | null>(null);
  const [win, setWin] = useState<WindowKey>("30d");
  const [loading, setLoading] = useState(false);
  const [pop, setPop] = useState<HoverPopState>(null);
  const [selectedDay, setSelectedDay] = useState<SelectedDayState>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!activeCompanyId) return;
    setLoading(true);
    setData(null);
    const params = new URLSearchParams({ companyId: activeCompanyId, window: win });
    fetch(`/api/platform-sentiment-timeline?${params}`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [activeCompanyId, win]);

  // Scroll to right (most recent) when data loads
  useEffect(() => {
    const containers = Array.from(document.querySelectorAll<HTMLDivElement>(".ntl-scroll"));
    containers.forEach((c) => { c.scrollLeft = c.scrollWidth; });
  }, [data, win]);

  const onHover = useCallback((day: NtlDay, label: string, e: React.MouseEvent) => {
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setPop({ day, feedLabel: label, x: rect.left + rect.width / 2, y: rect.top, below: rect.top < 200 });
  }, []);

  const onLeave = useCallback(() => setPop(null), []);

  const onDayClick = useCallback((feed: NtlFeed, day: NtlDay) => {
    setPop(null);
    setSelectedDay((prev) =>
      prev?.day.date === day.date && prev.feed.feedId === feed.feedId ? null : { feed, day }
    );
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setSelectedDay(null); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const feeds = data?.feeds ?? [];

  const legend = (
    <div className="ntl-legend">
      <span className="ntl-legend-item"><span className="ntl-legend-dot" style={{ background: "var(--nd-positive)" }} /> Positive</span>
      <span className="ntl-legend-item"><span className="ntl-legend-dot" style={{ background: "var(--nd-negative)" }} /> Negative</span>
      <span className="ntl-legend-item"><span className="ntl-legend-dot" style={{ background: "var(--nd-mixed)" }} /> Mixed</span>
      <span className="ntl-legend-item"><span className="ntl-legend-dot" style={{ background: "var(--nd-neutral)" }} /> Neutral</span>
      <span className="ntl-legend-note">dot size = items that day</span>
    </div>
  );

  return (
    <>
      <header className="topbar">
        <div>
          <div className="eyebrow">Analytics · Sentiment</div>
          <h1 className="page-title">Platform Sentiment</h1>
          <p className="page-desc">Overall sentiment trend per platform over time, averaged across all tracked entities.</p>
        </div>
      </header>

      <div className="page">
        <div className="toolbar">
          <div className="filter-group">
            <span className="filter-label">Window</span>
            <div className="seg seg-mono">
              {WIN_OPTS.map(({ key, label }) => (
                <button
                  key={key}
                  className={cx("seg-btn", win === key && "seg-btn-on")}
                  onClick={() => { setSelectedDay(null); setWin(key); }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="filter-group filter-group-right">
            <span className="result-meta">
              {loading
                ? "loading…"
                : feeds.length
                  ? <><strong>{feeds.length}</strong> {feeds.length === 1 ? "platform" : "platforms"}</>
                  : activeCompanyId ? "no data" : "select a company"}
            </span>
          </div>
        </div>

        {!loading && feeds.length === 0 && activeCompanyId && (
          <p className="t-meta" style={{ color: "var(--ink-50)", marginTop: 24, fontSize: 13 }}>
            No ingested items found for this company. Add tracked entities and configure sources to see sentiment here.
          </p>
        )}

        {feeds.length > 0 && (
          <div className="ntl-section">
            <div className="ntl-bar">
              <span className="ntl-bar-glyph">◉</span>
              <span className="ntl-bar-title">Sentiment by Platform</span>
              <span className="ntl-bar-spacer" />
              <span className="ntl-bar-meta">
                {loading ? "loading…" : `${feeds.length} ${feeds.length === 1 ? "platform" : "platforms"}`}
              </span>
            </div>
            {legend}
            <NewsTimeline
              feeds={feeds}
              win={win}
              feedFilter="all"
              style="trend"
              arrangement="stacked"
              density="minimal"
              showAvg={true}
              pop={pop}
              scrollRef={scrollRef}
              onHover={onHover}
              onLeave={onLeave}
              onDayClick={onDayClick}
              selectedDay={selectedDay ? { feedId: selectedDay.feed.feedId, date: selectedDay.day.date } : null}
            />
          </div>
        )}

        <p className="t-meta" style={{ color: "var(--ink-50)", marginTop: 14, fontSize: 12 }}>
          Hover any day for a quick summary. Click any day to see the clusters and items driving sentiment on that platform.
        </p>
      </div>

      <HoverPop pop={pop} />
      <PlatformDayDrawer
        selected={selectedDay}
        onClose={() => setSelectedDay(null)}
        companyId={activeCompanyId ?? ""}
      />
    </>
  );
}
