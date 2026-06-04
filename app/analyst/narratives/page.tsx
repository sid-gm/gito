"use client";

import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { cx, EntityBadge } from "@/components/primitives";
import { useCompany } from "@/components/CompanyContext";
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

  // News timeline state
  const [ntlData, setNtlData] = useState<NtlTimelineData | null>(null);
  const [ntlWin, setNtlWin] = useState<WindowKey>("30d");
  const [ntlLoading, setNtlLoading] = useState(false);
  const [ntlPop, setNtlPop] = useState<HoverPopState>(null);
  const [selectedDay, setSelectedDay] = useState<SelectedDayState>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Summarize state
  const [summarizing, setSummarizing] = useState(false);
  const [summarizeResult, setSummarizeResult] = useState<{ processed: number; total: number; socialProcessed: number; socialTotal: number } | null>(null);

  // Social timeline state
  const [socialData, setSocialData] = useState<NtlTimelineData | null>(null);
  const [socialLoading, setSocialLoading] = useState(false);
  const [socialPop, setSocialPop] = useState<HoverPopState>(null);
  const [socialSelectedDay, setSocialSelectedDay] = useState<SelectedDayState>(null);
  const socialScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!activeCompanyId) return;

    setNtlLoading(true);
    setSocialLoading(true);

    const params = new URLSearchParams({ companyId: activeCompanyId, window: "90d" });

    fetch(`/api/news-timeline?${params}`)
      .then((r) => r.json())
      .then((d) => { setNtlData(d); setNtlLoading(false); })
      .catch(() => setNtlLoading(false));

    fetch(`/api/social-timeline?${params}`)
      .then((r) => r.json())
      .then((d) => { setSocialData(d); setSocialLoading(false); })
      .catch(() => setSocialLoading(false));
  }, [activeCompanyId]);

  useEffect(() => {
    const containers = Array.from(
      document.querySelectorAll<HTMLDivElement>(".ntl-scroll")
    );
    containers.forEach((c) => { c.scrollLeft = c.scrollWidth; });

    let syncing = false;
    const handlers = containers.map((source) => {
      const handler = () => {
        if (syncing) return;
        syncing = true;
        containers.forEach((target) => {
          if (target !== source) target.scrollLeft = source.scrollLeft;
        });
        syncing = false;
      };
      source.addEventListener("scroll", handler, { passive: true });
      return { source, handler };
    });

    return () => {
      handlers.forEach(({ source, handler }) =>
        source.removeEventListener("scroll", handler)
      );
    };
  }, [ntlData, socialData, ntlWin]);

  // News handlers
  const onHover = useCallback((day: NtlDay, label: string, e: React.MouseEvent) => {
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setNtlPop({ day, feedLabel: label, x: rect.left + rect.width / 2, y: rect.top, below: rect.top < 200 });
  }, []);
  const onLeave = useCallback(() => setNtlPop(null), []);
  const onDayClick = useCallback((feed: NtlFeed, day: NtlDay) => {
    setNtlPop(null);
    setSocialSelectedDay(null);
    setSelectedDay((prev) =>
      prev?.day.date === day.date && prev.feed.feedId === feed.feedId ? null : { feed, day }
    );
  }, []);

  // Social handlers
  const onSocialHover = useCallback((day: NtlDay, label: string, e: React.MouseEvent) => {
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setSocialPop({ day, feedLabel: label, x: rect.left + rect.width / 2, y: rect.top, below: rect.top < 200 });
  }, []);
  const onSocialLeave = useCallback(() => setSocialPop(null), []);
  const onSocialDayClick = useCallback((feed: NtlFeed, day: NtlDay) => {
    setSocialPop(null);
    setSelectedDay(null);
    setSocialSelectedDay((prev) =>
      prev?.day.date === day.date && prev.feed.feedId === feed.feedId ? null : { feed, day }
    );
  }, []);

  const handleSummarize = useCallback(async () => {
    if (!activeCompanyId) return;
    setSummarizing(true);
    setSummarizeResult(null);
    try {
      const res = await fetch(`/api/run/summarize-news-timeline?companyId=${activeCompanyId}&force=true`, { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setSummarizeResult({ processed: data.processed, total: data.total, socialProcessed: data.socialProcessed, socialTotal: data.socialTotal });
        // Refresh both timelines
        const params = new URLSearchParams({ companyId: activeCompanyId, window: "90d" });
        const [ntl, social] = await Promise.all([
          fetch(`/api/news-timeline?${params}`).then((r) => r.json()),
          fetch(`/api/social-timeline?${params}`).then((r) => r.json()),
        ]);
        setNtlData(ntl);
        setSocialData(social);
      }
    } catch { /* best-effort */ }
    setSummarizing(false);
  }, [activeCompanyId]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setSelectedDay(null); setSocialSelectedDay(null); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Merge unique entities from both timelines, sorted by label
  const entities = useMemo(() => {
    const map = new Map<string, { id: string; label: string; type: string }>();
    for (const f of [...(ntlData?.feeds ?? []), ...(socialData?.feeds ?? [])]) {
      map.set(f.entityId, { id: f.entityId, label: f.entityLabel, type: f.entityType });
    }
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [ntlData, socialData]);

  const allNewsFeeds = ntlData?.feeds ?? [];
  const loading = ntlLoading || socialLoading;

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
          <div className="eyebrow">Part 3 · Narratives</div>
          <h1 className="page-title">Global Narratives</h1>
          <p className="page-desc">News and social conversation for your tracked entities over time, summarized per day.</p>
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
          <div className="filter-group filter-group-right" style={{ gap: 10 }}>
            {summarizeResult && (
              <span className="result-meta" style={{ color: "var(--ink-60)" }}>
                News: {summarizeResult.processed}/{summarizeResult.total} days · Social: {summarizeResult.socialProcessed}/{summarizeResult.socialTotal} clusters
              </span>
            )}
            <button
              className="btn btn-ghost btn-sm"
              onClick={handleSummarize}
              disabled={summarizing || !activeCompanyId}
            >
              {summarizing ? "Generating…" : "Generate summaries"}
            </button>
            <span className="result-meta">
              {loading ? "loading…" : <><strong>{entities.length}</strong> {entities.length === 1 ? "entity" : "entities"} · <strong>{NTL_WINDOWS[ntlWin]}</strong> days</>}
            </span>
          </div>
        </div>

        {!loading && entities.length === 0 && (
          <p className="t-meta" style={{ color: "var(--ink-50)", marginTop: 24, fontSize: 13 }}>
            No tracked entities found. Add entities and configure Google Alerts or social sources to see timelines here.
          </p>
        )}

        {entities.map((entity) => {
          const newsFeeds = allNewsFeeds.filter((f) => f.entityId === entity.id);
          const socialFeed = socialData?.feeds.find((f) => f.entityId === entity.id);

          return (
            <div key={entity.id} className="ntl-entity-group">
              <div className="ntl-entity-header">
                <EntityBadge label={entity.label} type={entity.type} />
                <span className="ntl-entity-label">{entity.label}</span>
              </div>

              {/* News Timeline */}
              <section className="ntl-section">
                <div className="ntl-bar">
                  <span className="ntl-bar-glyph">◈</span>
                  <span className="ntl-bar-title">News Timeline</span>
                  <span className="ntl-bar-eyebrow" style={{ marginLeft: 2 }}>Google Alerts</span>
                  <span className="ntl-bar-spacer" />
                  <span className="ntl-bar-meta">
                    {ntlLoading ? "loading…" : newsFeeds.length ? `${newsFeeds.length} feed${newsFeeds.length !== 1 ? "s" : ""}` : "no feeds"}
                  </span>
                </div>
                {newsFeeds.length > 0 && legend}
                <NewsTimeline
                  feeds={newsFeeds}
                  win={ntlWin}
                  feedFilter="all"
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

              {/* Social Timeline */}
              <section className="ntl-section" style={{ marginTop: 2 }}>
                <div className="ntl-bar">
                  <span className="ntl-bar-glyph">◈</span>
                  <span className="ntl-bar-title">Social Timeline</span>
                  <span className="ntl-bar-eyebrow" style={{ marginLeft: 2 }}>Reddit · X · HN</span>
                  <span className="ntl-bar-spacer" />
                  <span className="ntl-bar-meta">
                    {socialLoading ? "loading…" : socialFeed ? "active" : "no social activity"}
                  </span>
                </div>
                {socialFeed && legend}
                <NewsTimeline
                  feeds={socialFeed ? [socialFeed] : []}
                  win={ntlWin}
                  feedFilter="all"
                  style="trend"
                  arrangement="stacked"
                  density="recent"
                  showAvg={true}
                  pop={socialPop}
                  scrollRef={socialScrollRef}
                  onHover={onSocialHover}
                  onLeave={onSocialLeave}
                  onDayClick={onSocialDayClick}
                  selectedDay={socialSelectedDay ? { feedId: socialSelectedDay.feed.feedId, date: socialSelectedDay.day.date } : null}
                />
              </section>
            </div>
          );
        })}

        <p className="t-meta" style={{ color: "var(--ink-50)", marginTop: 14, fontSize: 12 }}>
          Hover any day for a quick summary. Click any day for the full breakdown including topic segments and source articles.
        </p>
      </div>

      <DayDetailDrawer source="news" selected={selectedDay} onClose={() => setSelectedDay(null)} />
      <DayDetailDrawer source="social" selected={socialSelectedDay} onClose={() => setSocialSelectedDay(null)} />
    </>
  );
}
