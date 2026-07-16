"use client";

import { useState } from "react";
import {
  PLATFORMS,
  RAW_ITEMS,
  type PlatformKey,
  platformMeta,
  topicMeta,
  sentColor,
  sentLabel,
  fmtScore,
} from "@/components/analyst/data";

const FILTERS: { key: "all" | PlatformKey; label: string; dot: string }[] = [
  { key: "all", label: "All", dot: "#7b8398" },
  ...PLATFORMS.map((p) => ({ key: p.key, label: p.label, dot: p.color })),
];

export default function RawDataPage() {
  const [filter, setFilter] = useState<"all" | PlatformKey>("all");
  const [search, setSearch] = useState("");

  const q = search.trim().toLowerCase();
  let rows = RAW_ITEMS.filter((r) => filter === "all" || r.platform === filter);
  if (q) {
    rows = rows.filter((r) =>
      `${r.text} ${r.author} ${topicMeta(r.topic).label}`
        .toLowerCase()
        .includes(q)
    );
  }

  const meta =
    `${rows.length} of ${RAW_ITEMS.length} posts` +
    (filter !== "all" ? ` · ${platformMeta(filter).label}` : "") +
    (q ? ` · matching "${search}"` : "");

  return (
    <div>
      <div className="an-raw-toolbar">
        <div className="an-plat-filters">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`an-plat-filter${filter === f.key ? " an-plat-filter-on" : ""}`}
            >
              <span
                className="an-plat-filter-dot"
                style={{ background: f.dot }}
              />
              {f.label}
            </button>
          ))}
        </div>
        <div className="an-search-wrap">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search posts, authors…"
            className="an-search"
          />
        </div>
      </div>

      <div className="an-table">
        <div className="an-tr an-thead">
          <div />
          <div>Source</div>
          <div>Content</div>
          <div>Topic</div>
          <div>Sentiment</div>
          <div style={{ textAlign: "right" }}>Reach</div>
        </div>
        {rows.map((r, i) => {
          const pm = platformMeta(r.platform);
          const tm = topicMeta(r.topic);
          return (
            <div key={i} className="an-tr an-row">
              <div>
                <span
                  className="an-tag"
                  style={{ background: pm.color + "22", color: pm.color }}
                >
                  {pm.tag}
                </span>
              </div>
              <div className="an-cell-source">
                <div className="an-cell-author">{r.author}</div>
                <div className="an-cell-meta">
                  {pm.label} · {r.timeAgo}
                </div>
              </div>
              <div className="an-cell-text">{r.text}</div>
              <div>
                <span
                  className="an-topic-pill"
                  style={{ background: tm.color + "1c", color: tm.color }}
                >
                  {tm.label}
                </span>
              </div>
              <div className="an-cell-sent">
                <span
                  className="an-sent-dot"
                  style={{ background: sentColor(r.sentiment) }}
                />
                <span className="an-cell-sent-label">
                  {sentLabel(r.sentiment)}
                </span>
                <span className="an-cell-sent-score">
                  {fmtScore(r.sentiment)}
                </span>
              </div>
              <div className="an-cell-eng">{r.engagement}</div>
            </div>
          );
        })}
      </div>
      <div className="an-rows-meta">{meta}</div>
    </div>
  );
}
