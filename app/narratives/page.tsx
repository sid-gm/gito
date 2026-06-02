"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { cx } from "@/components/primitives";
import { useCompany } from "@/components/CompanyContext";
import "./timeline.css";
import { NewsTimeline } from "@/components/news-timeline/TimelineTrack";
import { DayDetailDrawer } from "@/components/news-timeline/DayDetailDrawer";
import { NTL_WINDOWS } from "@/components/news-timeline/timeline_core";
import type { HoverPopState, NtlTimelineData, WindowKey, NtlDay, NtlFeed, SelectedDayState } from "@/components/news-timeline/timeline_core";

const WIN_OPTS: { key: WindowKey; label: string }[] = [
  { key: "7d",  label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
];

export default function NarrativesPage() {
  const { activeCompanyId } = useCompany();

  const [ntlData, setNtlData] = useState<NtlTimelineData | null>(null);
  const [ntlWin, setNtlWin] = useState<WindowKey>("30d");
  const [ntlFeedFilter, setNtlFeedFilter] = useState("all");
  const [ntlLoading, setNtlLoading] = useState(false);
  const [ntlPop, setNtlPop] = useState<HoverPopState>(null);
  const [selectedDay, setSelectedDay] = useState<SelectedDayState>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!activeCompanyId) return;
    setNtlLoading(true);
    const params = new URLSearchParams({ companyId: activeCompanyId, window: "90d" });
    fetch(`/api/news-timeline?${params}`)
      .then((r) => r.json())
      .then((d) => { setNtlData(d); setNtlLoading(false); })
      .catch(() => setNtlLoading(false));
  }, [activeCompanyId]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
  }, [ntlData, ntlWin]);

  const onHover = useCallback((day: NtlDay, label: string, e: React.MouseEvent) => {
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setNtlPop({ day, feedLabel: label, x: rect.left + rect.width / 2, y: rect.top, below: rect.top < 200 });
  }, []);

  const onLeave = useCallback(() => setNtlPop(null), []);

  const onDayClick = useCallback((feed: NtlFeed, day: NtlDay) => {
    setNtlPop(null);
    setSelectedDay((prev) =>
      prev?.day.date === day.date && prev.feed.feedId === feed.feedId ? null : { feed, day }
    );
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setSelectedDay(null); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const allFeeds = ntlData?.feeds ?? [];
  const filteredFeeds = ntlFeedFilter === "all" ? allFeeds : allFeeds.filter((f) => f.feedId === ntlFeedFilter);

  return (
    <>
      <header className="topbar">
        <div>
          <div className="eyebrow">Part 3 · Narratives</div>
          <h1 className="page-title">Global Narratives</h1>
          <p className="page-desc">How the news cycle reads on your tracked entities over time — one sentiment track per Google Alerts feed, summarized per day.</p>
        </div>
      </header>

      <div className="page">
        <div className="toolbar">
          <div className="filter-group">
            <span className="filter-label">Window</span>
            <div className="seg seg-mono">
              {WIN_OPTS.map(({ key, label }) => (
                <button key={key} className={cx("seg-btn", ntlWin === key && "seg-btn-on")} onClick={() => setNtlWin(key)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="filter-group">
            <span className="filter-label">Feed</span>
            <div className="seg">
              <button className={cx("seg-btn", ntlFeedFilter === "all" && "seg-btn-on")} onClick={() => setNtlFeedFilter("all")}>
                All <span className="seg-count">{allFeeds.length}</span>
              </button>
              {allFeeds.map((f) => (
                <button key={f.feedId} className={cx("seg-btn", ntlFeedFilter === f.feedId && "seg-btn-on")} onClick={() => setNtlFeedFilter(f.feedId)}>
                  {f.feedLabel}
                </button>
              ))}
            </div>
          </div>
          <div className="filter-group filter-group-right">
            <span className="result-meta">
              <strong>{filteredFeeds.length}</strong> feed{filteredFeeds.length === 1 ? "" : "s"} · <strong>{NTL_WINDOWS[ntlWin]}</strong> days
            </span>
          </div>
        </div>

        <section className="ntl-section">
          <div className="ntl-bar">
            <span className="ntl-bar-glyph">◈</span>
            <span className="ntl-bar-title">News Timeline</span>
            <span className="ntl-bar-eyebrow" style={{ marginLeft: 2 }}>Google Alerts</span>
            <span className="ntl-bar-spacer" />
            <span className="ntl-bar-meta">
              {ntlLoading ? "loading…" : allFeeds.length ? `${allFeeds.length} feed${allFeeds.length !== 1 ? "s" : ""}` : "no feeds"}
            </span>
          </div>

          {!ntlLoading && allFeeds.length > 0 && (
            <div className="ntl-legend">
              <span className="ntl-legend-item"><span className="ntl-legend-dot" style={{ background: "var(--nd-positive)" }} /> Positive</span>
              <span className="ntl-legend-item"><span className="ntl-legend-dot" style={{ background: "var(--nd-negative)" }} /> Negative</span>
              <span className="ntl-legend-item"><span className="ntl-legend-dot" style={{ background: "var(--nd-mixed)" }} /> Mixed</span>
              <span className="ntl-legend-item"><span className="ntl-legend-dot" style={{ background: "var(--nd-neutral)" }} /> Neutral</span>
              <span className="ntl-legend-note">dot size = items that day · raw articles purged after 7d, summaries kept</span>
            </div>
          )}

          <NewsTimeline
            feeds={ntlData?.feeds ?? []}
            win={ntlWin}
            feedFilter={ntlFeedFilter}
            style="trend"
            arrangement="stacked"
            density="recent"
            showAvg={true}
            pop={ntlPop}
            scrollRef={scrollRef}
            onHover={onHover}
            onLeave={onLeave}
            onDayClick={onDayClick}
            selectedDay={selectedDay ? { feedId: selectedDay.feed.feedId, date: selectedDay.day.date } : null}
          />
        </section>

        <p className="t-meta" style={{ color: "var(--ink-50)", marginTop: 14, fontSize: 12 }}>
          Hover any day for a quick summary. Click any day for the full breakdown including topic segments and source articles.
        </p>
      </div>

      <DayDetailDrawer selected={selectedDay} onClose={() => setSelectedDay(null)} />
    </>
  );
}
