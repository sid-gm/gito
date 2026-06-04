"use client";

import React from "react";
import { cx, EntityBadge } from "@/components/primitives";
import {
  NtlFeed, NtlDay, WindowKey, StyleKey, DensityKey, ArrangementKey,
  HoverPopState,
  NTL_BAND_H, NTL_CHIP_LANE, NTL_WINDOWS, NTL_COLW,
  expandedCount, feedStats, windowSlice, scoreToY, dotRadius,
  fmtScore, fmtDayMon, fmtFullDate, sentSlug, getFeedColor,
  SentPill, TimelineAxis, GridLines, HoverPop,
} from "./timeline_core";

// ── Build polyline segments for consecutive non-null days ──────────────────
function buildSegments(days: NtlDay[]) {
  const segs: { i: number; score: number }[][] = [];
  let cur: { i: number; score: number }[] | null = null;
  days.forEach((d, i) => {
    if (d.sentimentScore == null) { cur = null; return; }
    if (!cur) { cur = []; segs.push(cur); }
    cur.push({ i, score: d.sentimentScore });
  });
  return segs;
}

// ── Feed header (sticky-left) ───────────────────────────────────────────────
function FeedHeader({ feed, stats, showAvg }: {
  feed: NtlFeed;
  stats: ReturnType<typeof feedStats>;
  showAvg: boolean;
}) {
  const slug = stats.avg == null ? "neutral" : sentSlug(stats.label);
  const trendCls = stats.trend > 0.04 ? "ntl-trend-up" : stats.trend < -0.04 ? "ntl-trend-down" : "ntl-trend-flat";
  const trendGlyph = stats.trend > 0.04 ? "▲" : stats.trend < -0.04 ? "▼" : "▬";
  return (
    <div className="ntl-fhead">
      <div className="ntl-fhead-pad">
        <div className="ntl-feed-name">
          <span className="ntl-feed-title">{feed.feedLabel}</span>
        </div>
        <EntityBadge label={feed.entityLabel} type={feed.entityType} />
        {showAvg && (
          <div className="ntl-avg">
            <div className="ntl-avg-row">
              <span className={cx("ntl-avg-score", `nd-text-${slug}`)}>{fmtScore(stats.avg)}</span>
              <span className={cx("ntl-avg-trend", trendCls)}>
                <span style={{ fontSize: 8 }}>{trendGlyph}</span>
                {stats.trend === 0 ? "flat" : `${stats.trend > 0 ? "+" : "−"}${Math.abs(stats.trend).toFixed(2)}`}
              </span>
            </div>
            <SentPill label={stats.avg == null ? null : stats.label} />
            <div className="ntl-avg-meta">
              <span>{stats.totalItems} items</span>
              <span>·</span>
              <span>{stats.activeDays} active days</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Feed rail (chip lane + chart band + dots) ─────────────────────────────
function FeedRail({ feed, days, colW, win, density, style, onHover, onLeave, onDayClick, selectedDay }: {
  feed: NtlFeed;
  days: NtlDay[];
  colW: number;
  win: WindowKey;
  density: DensityKey;
  style: StyleKey;
  onHover: (day: NtlDay, label: string, e: React.MouseEvent) => void;
  onLeave: () => void;
  onDayClick: (feed: NtlFeed, day: NtlDay) => void;
  selectedDay: { feedId: string; date: string } | null;
}) {
  const N = days.length;
  const expCount = expandedCount(win, density);
  const railW = N * colW;
  const flat = style === "rail";
  const hasChips = expCount > 0 && colW >= 64;
  const laneH = hasChips ? NTL_CHIP_LANE : 12;
  const segs = flat ? [] : buildSegments(days);
  const gid = `ntl-grad-${feed.feedId}`;
  const chipW = Math.max(58, colW - 14);
  const stats = feed._stats ?? feedStats(days);

  return (
    <div className="ntl-row ntl-feed">
      <FeedHeader feed={feed} stats={stats} showAvg={feed._showAvg ?? true} />
      <div className="ntl-rail">
        <div className="ntl-rail-inner" style={{ width: railW, height: laneH + NTL_BAND_H }}>
          <GridLines N={N} colW={colW} win={win} />

          {/* chart band */}
          <div className="ntl-band" style={{ top: laneH, height: NTL_BAND_H, position: "absolute", left: 0, width: railW }}>
            <svg viewBox={`0 0 ${N} 100`} preserveAspectRatio="none" style={{ width: railW, height: NTL_BAND_H }}>
              <defs>
                <linearGradient id={gid} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="100">
                  <stop offset="0%" stopColor="var(--pos)" stopOpacity="0.20" />
                  <stop offset="44%" stopColor="var(--pos)" stopOpacity="0.03" />
                  <stop offset="50%" stopColor="var(--ink)" stopOpacity="0" />
                  <stop offset="56%" stopColor="var(--neg)" stopOpacity="0.03" />
                  <stop offset="100%" stopColor="var(--neg)" stopOpacity="0.20" />
                </linearGradient>
              </defs>
              <line x1="0" y1="50" x2={N} y2="50" stroke="var(--border)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              {!flat && segs.map((seg, si) => {
                if (seg.length < 2) return null;
                const linePts = seg.map((p) => `${(p.i + 0.5).toFixed(3)},${(50 - p.score * 42).toFixed(2)}`).join(" ");
                const first = seg[0], last = seg[seg.length - 1];
                const area = `M ${(first.i + 0.5).toFixed(3)},50 L ` +
                  seg.map((p) => `${(p.i + 0.5).toFixed(3)},${(50 - p.score * 42).toFixed(2)}`).join(" L ") +
                  ` L ${(last.i + 0.5).toFixed(3)},50 Z`;
                return (
                  <g key={si}>
                    <path d={area} fill={`url(#${gid})`} />
                    <polyline points={linePts} fill="none" stroke="var(--ink-40)" strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
                  </g>
                );
              })}
            </svg>

            {days.map((d, i) => {
              const cx0 = (i + 0.5) * colW;
              if (d.sentimentScore == null) {
                // Manual-only day: render a neutral clickable dot if items exist
                if ((d.itemCount ?? 0) > 0) {
                  const r = dotRadius(d.itemCount);
                  const isToday = i === N - 1;
                  const isSelected = selectedDay?.feedId === feed.feedId && selectedDay?.date === d.date;
                  return (
                    <div
                      key={d.date}
                      className={cx("ntl-dot ntl-dot-neutral", isToday && "ntl-dot-recent", isSelected && "ntl-dot-active")}
                      style={{ left: cx0, top: NTL_BAND_H / 2, width: r * 2, height: r * 2 }}
                      onMouseEnter={(e) => onHover(d, feed.feedLabel, e)}
                      onMouseLeave={onLeave}
                      onClick={(e) => { e.stopPropagation(); onDayClick(feed, d); }}
                    />
                  );
                }
                return <div key={d.date} className="ntl-null" style={{ left: cx0, top: NTL_BAND_H / 2 }} />;
              }
              const slug = sentSlug(d.sentimentLabel);
              const y = flat ? NTL_BAND_H / 2 : scoreToY(d.sentimentScore);
              const r = dotRadius(d.itemCount);
              const isToday = i === N - 1;
              const isSelected = selectedDay?.feedId === feed.feedId && selectedDay?.date === d.date;
              return (
                <div
                  key={d.date}
                  className={cx("ntl-dot", `ntl-dot-${slug}`, isToday && "ntl-dot-recent", isSelected && "ntl-dot-active")}
                  style={{ left: cx0, top: y, width: r * 2, height: r * 2 }}
                  onMouseEnter={(e) => onHover(d, feed.feedLabel, e)}
                  onMouseLeave={onLeave}
                  onClick={(e) => { e.stopPropagation(); onDayClick(feed, d); }}
                />
              );
            })}
          </div>

          {/* chip lane */}
          {hasChips && days.map((d, i) => {
            if (d.sentimentScore == null) return null;
            if (i < N - expCount) return null;
            const cx0 = (i + 0.5) * colW;
            const slug = sentSlug(d.sentimentLabel);
            const dm = fmtDayMon(d.date);
            const y = flat ? NTL_BAND_H / 2 : scoreToY(d.sentimentScore);
            const isSelected = selectedDay?.feedId === feed.feedId && selectedDay?.date === d.date;
            return (
              <React.Fragment key={d.date}>
                <div className="ntl-chip-stem" style={{ left: cx0, top: laneH - 4, height: y + 4 }} />
                <div
                  className={cx("ntl-chip", isSelected && "ntl-chip-active")}
                  style={{ left: cx0, width: chipW, bottom: NTL_BAND_H + 4 }}
                  onMouseEnter={(e) => onHover(d, feed.feedLabel, e)}
                  onMouseLeave={onLeave}
                  onClick={() => onDayClick(feed, d)}
                >
                  <div className="ntl-chip-head">
                    <span className="ntl-chip-date">{i === N - 1 ? "Today" : `${dm.mon} ${dm.day}`}</span>
                    <span className={cx("ntl-chip-score", `nd-text-${slug}`)}>{fmtScore(d.sentimentScore)}</span>
                  </div>
                  <div className="ntl-chip-text">{d.aiSummary}</div>
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Combined overlay — all feeds in one band ───────────────────────────────
function CombinedTimeline({ feeds, colW, win, onHover, onLeave, onDayClick, selectedDay }: {
  feeds: NtlFeed[];
  colW: number;
  win: WindowKey;
  onHover: (day: NtlDay, label: string, e: React.MouseEvent) => void;
  onLeave: () => void;
  onDayClick: (feed: NtlFeed, day: NtlDay) => void;
  selectedDay: { feedId: string; date: string } | null;
}) {
  const N = NTL_WINDOWS[win];
  const railW = N * colW;
  const H = 196;
  const yOf = (s: number) => (50 - Math.max(-1, Math.min(1, s)) * 42) / 100 * H;
  return (
    <div className="ntl-row ntl-feed">
      <div className="ntl-fhead">
        <div className="ntl-fhead-pad">
          <div className="ntl-feed-title">All feeds</div>
          <div className="ntl-avg-meta" style={{ flexDirection: "column", gap: 8, alignItems: "flex-start", marginTop: 4 }}>
            {feeds.map((f, fi) => (
              <span key={f.feedId} className="ntl-feed-legend-item" style={{ fontSize: 11.5 }}>
                <span className="ntl-feed-legend-line" style={{ background: getFeedColor(fi) }} />
                {f.feedLabel}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="ntl-rail">
        <div className="ntl-rail-inner" style={{ width: railW, height: H + 16 }}>
          <GridLines N={N} colW={colW} win={win} />
          <div className="ntl-band" style={{ position: "absolute", top: 0, left: 0, width: railW, height: H }}>
            <svg viewBox={`0 0 ${N} 100`} preserveAspectRatio="none" style={{ width: railW, height: H }}>
              <line x1="0" y1="50" x2={N} y2="50" stroke="var(--border)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              {feeds.map((f, fi) => {
                const wdays = windowSlice(f, win);
                return buildSegments(wdays).map((seg, si) => {
                  if (seg.length < 2) return null;
                  const pts = seg.map((p) => `${(p.i + 0.5).toFixed(3)},${(50 - p.score * 42).toFixed(2)}`).join(" ");
                  return <polyline key={f.feedId + si} points={pts} fill="none" stroke={getFeedColor(fi)} strokeWidth="1.8" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />;
                });
              })}
            </svg>
            {feeds.map((f, fi) =>
              windowSlice(f, win).map((d, i) => {
                if (d.sentimentScore == null) return null;
                const isSelected = selectedDay?.feedId === f.feedId && selectedDay?.date === d.date;
                return (
                  <div key={f.feedId + d.date}
                    className={cx("ntl-dot", isSelected && "ntl-dot-active")}
                    style={{ left: (i + 0.5) * colW, top: yOf(d.sentimentScore), width: 9, height: 9, background: getFeedColor(fi) }}
                    onMouseEnter={(e) => onHover(d, f.feedLabel, e)}
                    onMouseLeave={onLeave}
                    onClick={(e) => { e.stopPropagation(); onDayClick(f, d); }}
                  />
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Vertical rail — one focused feed, newest first ─────────────────────────
function VerticalView({ feeds, focusId, onFocus, win, density, onDayClick, selectedDay }: {
  feeds: NtlFeed[];
  focusId: string;
  onFocus: (id: string) => void;
  win: WindowKey;
  density: DensityKey;
  onDayClick: (feed: NtlFeed, day: NtlDay) => void;
  selectedDay: { feedId: string; date: string } | null;
}) {
  const feed = feeds.find((f) => f.feedId === focusId) ?? feeds[0];
  const days = windowSlice(feed, win).slice().reverse();
  const expCount = expandedCount(win, density) || 6;
  return (
    <div>
      <div className="ntl-tabs">
        {feeds.map((f) => (
          <button key={f.feedId} className={cx("ntl-tab", f.feedId === focusId && "ntl-tab-on")} onClick={() => onFocus(f.feedId)}>
            {f.feedLabel}
          </button>
        ))}
      </div>
      <div className="ntl-vrail">
        {days.map((d, idx) => {
          const present = d.sentimentScore != null;
          const slug = present ? sentSlug(d.sentimentLabel) : "neutral";
          const expanded = idx < expCount;
          const color = present ? `var(--nd-${slug})` : "var(--ink-30)";
          const dm = fmtDayMon(d.date);
          const isSelected = selectedDay?.feedId === feed.feedId && selectedDay?.date === d.date;
          return (
            <div key={d.date} className={cx("ntl-vrow", !present && "ntl-vrow-null", isSelected && "ntl-vrow-active")} onClick={() => present && onDayClick(feed, d)} style={present ? { cursor: "pointer" } : undefined}>
              <div className="ntl-vrow-date">{idx === 0 ? "Today" : `${dm.mon} ${dm.day}`}</div>
              <div className="ntl-vrow-spine" />
              <div className="ntl-vrow-node" style={{ background: color, top: 15, width: present ? 11 : 8, height: present ? 11 : 8 }} />
              <div className="ntl-vrow-body">
                <div className="ntl-vrow-meta">
                  <SentPill label={present ? d.sentimentLabel : null} />
                  {present && <span className={cx("ntl-chip-score", `nd-text-${slug}`)} style={{ fontSize: 11 }}>{fmtScore(d.sentimentScore)}</span>}
                  <span className="ntl-pop-items" style={{ marginLeft: 0 }}>{d.itemCount || 0} items</span>
                </div>
                <div className={cx("ntl-vrow-text", !expanded && "ntl-vrow-text-clamp")}>
                  {present ? d.aiSummary : "No Google Alerts items ingested this day."}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── NewsTimeline section ───────────────────────────────────────────────────
export function NewsTimeline({ feeds, win, feedFilter, style, arrangement, density, showAvg, pop, scrollRef, onHover, onLeave, onDayClick, selectedDay }: {
  feeds: NtlFeed[];
  win: WindowKey;
  feedFilter: string;
  style: StyleKey;
  arrangement: ArrangementKey;
  density: DensityKey;
  showAvg: boolean;
  pop: HoverPopState;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onHover: (day: NtlDay, label: string, e: React.MouseEvent) => void;
  onLeave: () => void;
  onDayClick?: (feed: NtlFeed, day: NtlDay) => void;
  selectedDay?: { feedId: string; date: string } | null;
}) {
  const colW = NTL_COLW[win];
  const filtered = feedFilter === "all" ? feeds : feeds.filter((f) => f.feedId === feedFilter);
  const [focusId, setFocusId] = React.useState(feeds[0]?.feedId ?? "");

  const viewFeeds = filtered.map((f) => {
    const wdays = windowSlice(f, win);
    return { ...f, _wdays: wdays, _stats: feedStats(wdays), _showAvg: showAvg };
  });

  const isVertical = style === "vertical";
  const isCombined = !isVertical && arrangement === "combined" && filtered.length > 1;
  const isTabs = !isVertical && !isCombined && arrangement === "tabs" && filtered.length > 1;
  const tabFeeds = isTabs ? viewFeeds.filter((f) => f.feedId === focusId) : viewFeeds;
  const axisRef = tabFeeds[0] ?? viewFeeds[0];

  if (feeds.length === 0) {
    return (
      <div style={{ padding: "24px 16px", textAlign: "center", color: "var(--ink-50)", fontSize: 13 }}>
        No RSS feeds configured yet. Add Google Alerts feeds on the Track page.
      </div>
    );
  }

  const noop = () => {};
  const clickHandler = onDayClick ?? noop;
  const selDay = selectedDay ?? null;

  return (
    <>
      {isVertical ? (
        <VerticalView feeds={viewFeeds} focusId={focusId} onFocus={setFocusId} win={win} density={density} onDayClick={clickHandler} selectedDay={selDay} />
      ) : (
        <>
          {isTabs && (
            <div className="ntl-tabs">
              {viewFeeds.map((f) => (
                <button key={f.feedId} className={cx("ntl-tab", f.feedId === focusId && "ntl-tab-on")} onClick={() => setFocusId(f.feedId)}>{f.feedLabel}</button>
              ))}
            </div>
          )}
          <div className="ntl-scroll" ref={scrollRef}>
            <div className="ntl-inner">
              {axisRef && <TimelineAxis days={axisRef._wdays ?? []} colW={colW} win={win} />}
              {isCombined ? (
                <CombinedTimeline feeds={viewFeeds} colW={colW} win={win} onHover={onHover} onLeave={onLeave} onDayClick={clickHandler} selectedDay={selDay} />
              ) : (
                tabFeeds.map((f) => (
                  <FeedRail key={f.feedId} feed={f} days={f._wdays ?? []} colW={colW} win={win} density={density} style={style} onHover={onHover} onLeave={onLeave} onDayClick={clickHandler} selectedDay={selDay} />
                ))
              )}
            </div>
          </div>
        </>
      )}
      <HoverPop pop={pop} />
    </>
  );
}
