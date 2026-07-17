"use client";

import { useEffect, useState } from "react";
import { useAnalyst } from "@/components/analyst/AnalystContext";
import {
  PLATFORMS,
  type PlatformKey,
  type AnalystItem,
  platformMeta,
  topicColor,
  sentColor,
  sentLabel,
  fmtScore,
  fmtCount,
  timeAgo,
} from "@/components/analyst/data";

const FILTERS: { key: "all" | PlatformKey; label: string; dot: string }[] = [
  { key: "all", label: "All", dot: "#7b8398" },
  ...PLATFORMS.filter((p) => p.key !== "manual").map((p) => ({
    key: p.key,
    label: p.label,
    dot: p.color,
  })),
];

const PAGE_SIZE = 50;

export default function RawDataPage() {
  const { companyId, days } = useAnalyst();
  const [filter, setFilter] = useState<"all" | PlatformKey>("all");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState(""); // debounced
  const [rows, setRows] = useState<AnalystItem[]>([]);
  const [total, setTotal] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  const queryKey = `${companyId}|${days}|${filter}|${q}`;
  const loading = companyId != null && loadedKey !== queryKey;

  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    const key = `${companyId}|${days}|${filter}|${q}`;
    const params = new URLSearchParams({
      companyId,
      days: String(days),
      limit: String(PAGE_SIZE),
    });
    if (filter !== "all") params.set("platform", filter);
    if (q) params.set("q", q);

    fetch(`/api/analyst/items?${params}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data) => {
        if (cancelled) return;
        setRows(data.items ?? []);
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
  }, [companyId, days, filter, q]);

  async function loadMore() {
    if (!companyId || nextOffset == null) return;
    const params = new URLSearchParams({
      companyId,
      days: String(days),
      limit: String(PAGE_SIZE),
      offset: String(nextOffset),
    });
    if (filter !== "all") params.set("platform", filter);
    if (q) params.set("q", q);
    const res = await fetch(`/api/analyst/items?${params}`);
    if (!res.ok) return;
    const data = await res.json();
    setRows((prev) => [...prev, ...(data.items ?? [])]);
    setNextOffset(data.nextOffset ?? null);
  }

  const meta = loading
    ? "Loading…"
    : `${rows.length} of ${total.toLocaleString()} items` +
      (filter !== "all" ? ` · ${platformMeta(filter).label}` : "") +
      (q ? ` · matching "${q}"` : "") +
      ` · last ${days} days`;

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
        {rows.map((r) => {
          const pm = platformMeta(r.platform);
          const tc = topicColor(r.topicId);
          const text = [r.title, r.body].filter(Boolean).join(" — ");
          const content = r.url ? (
            <a href={r.url} target="_blank" rel="noreferrer" className="an-cell-link">
              {text || r.url}
            </a>
          ) : (
            text || "—"
          );
          return (
            <div key={r.id} className="an-tr an-row">
              <div>
                <span
                  className="an-tag"
                  style={{ background: pm.color + "22", color: pm.color }}
                >
                  {pm.tag}
                </span>
              </div>
              <div className="an-cell-source">
                <div className="an-cell-author">{r.author ?? "—"}</div>
                <div className="an-cell-meta">
                  {pm.label} · {r.kind} · {timeAgo(r.publishedAt ?? r.createdAt)}
                </div>
              </div>
              <div className="an-cell-text">{content}</div>
              <div>
                {r.topicLabel ? (
                  <span
                    className="an-topic-pill"
                    style={{ background: tc + "1c", color: tc }}
                  >
                    {r.topicLabel}
                  </span>
                ) : (
                  <span className="an-cell-meta">—</span>
                )}
              </div>
              <div className="an-cell-sent">
                {r.sentimentScore != null ? (
                  <>
                    <span
                      className="an-sent-dot"
                      style={{ background: sentColor(r.sentimentScore) }}
                    />
                    <span className="an-cell-sent-label">
                      {sentLabel(r.sentimentScore)}
                    </span>
                    <span className="an-cell-sent-score">
                      {fmtScore(r.sentimentScore)}
                    </span>
                  </>
                ) : (
                  <span className="an-cell-meta">pending</span>
                )}
              </div>
              <div className="an-cell-eng">{fmtCount(r.reach)}</div>
            </div>
          );
        })}
        {!loading && rows.length === 0 && (
          <div className="an-empty">
            No items in this window yet — run the collector or add keywords in
            Sources.
          </div>
        )}
      </div>

      {nextOffset != null && (
        <button className="an-loadmore" onClick={loadMore}>
          Load more
        </button>
      )}
      <div className="an-rows-meta">{meta}</div>
    </div>
  );
}
