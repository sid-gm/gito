"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import {
  cx, PLATFORMS, PlatformChip, SignalTag, SentimentBar,
  EntityBadge, Sparkline, Dot,
} from "@/components/primitives";
import { useCompany } from "@/components/CompanyContext";
import ThreadIngestDialog from "@/components/ThreadIngestDialog";

type FeedItem = {
  id: string;
  entityId: string | null;
  entityLabel: string | null;
  platform: string;
  url: string | null;
  externalId: string | null;
  title: string | null;
  body: string | null;
  author: string | null;
  publishedAt: string | null;
  subtype: string | null;
  createdAt: string;
  threadIngested?: boolean;
  clusterId?: string | null;
  clusterLabel?: string | null;
};

type Entity = { id: string; label: string; entityType: string };

function relativeTime(iso: string | null) {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function fillSeries(
  sparse: { date: string; count: number }[],
  slots: number,
  stepMs: number
): number[] {
  const map = new Map(sparse.map((r) => [r.date, r.count]));
  const now = Date.now();
  return Array.from({ length: slots }, (_, i) => {
    const t = new Date(now - (slots - 1 - i) * stepMs);
    const key = t.toISOString().slice(0, 10);
    return map.get(key) ?? 0;
  });
}

export default function FeedPage() {
  const { activeCompanyId } = useCompany();
  const [items, setItems] = useState<FeedItem[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [platform, setPlatform] = useState("all");
  const [entityId, setEntityId] = useState("all");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"list" | "table">("list");
  const [loading, setLoading] = useState(true);
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);
  const [embedRunning, setEmbedRunning] = useState(false);
  const [embedResult, setEmbedResult] = useState<string | null>(null);
  const [clusterRunning, setClusterRunning] = useState(false);
  const [clusterResult, setClusterResult] = useState<string | null>(null);
  const [threadDialogOpen, setThreadDialogOpen] = useState(false);
  const [threadDialogUrl, setThreadDialogUrl] = useState<string | null>(null);
  const [sessionIngestedUrls, setSessionIngestedUrls] = useState<Set<string>>(new Set());
  const [platformCounts, setPlatformCounts] = useState<Record<string, number>>({ all: 0 });
  const [totalSpark, setTotalSpark] = useState<number[]>([]);

  const runEmbed = useCallback(async () => {
    setEmbedRunning(true);
    setEmbedResult(null);
    try {
      const res = await fetch("/api/run/embed", { method: "POST" });
      const data = await res.json();
      setEmbedResult(
        data.embedded === 0
          ? "nothing to embed"
          : `${data.embedded} embedded · all done`
      );
    } catch {
      setEmbedResult("error — check console");
    } finally {
      setEmbedRunning(false);
    }
  }, []);

  const runCluster = useCallback(async () => {
    setClusterRunning(true);
    setClusterResult(null);
    try {
      const res = await fetch("/api/run/cluster", { method: "POST" });
      const data = await res.json();
      setClusterResult(
        data.assigned === 0 && data.created === 0
          ? "nothing to cluster"
          : `${data.assigned} assigned · ${data.created} new`
      );
    } catch {
      setClusterResult("error — check console");
    } finally {
      setClusterRunning(false);
    }
  }, []);

  const fetchItems = useCallback(async () => {
    if (!activeCompanyId) return;
    setLoading(true);
    const params = new URLSearchParams({ limit: "500", companyId: activeCompanyId });
    if (platform !== "all") params.set("platform", platform);
    if (entityId !== "all") params.set("entityId", entityId);
    const res = await fetch(`/api/items?${params}`);
    setItems(await res.json());
    setLoading(false);
  }, [platform, entityId, activeCompanyId]);

  const fetchCounts = useCallback(async () => {
    if (!activeCompanyId) return;
    const params = new URLSearchParams({ companyId: activeCompanyId });
    if (entityId !== "all") params.set("entityId", entityId);
    const res = await fetch(`/api/items/counts?${params}`);
    setPlatformCounts(await res.json());
  }, [entityId, activeCompanyId]);

  useEffect(() => {
    if (activeCompanyId) fetch(`/api/entities?companyId=${activeCompanyId}`).then((r) => r.json()).then(setEntities);
  }, [activeCompanyId]);

  useEffect(() => {
    if (!activeCompanyId) return;
    fetch(`/api/items/timeseries?days=30&companyId=${activeCompanyId}`)
      .then((r) => r.json())
      .then((d) => setTotalSpark(fillSeries(d.series, 30, 86400000)));
  }, [activeCompanyId]);

  useEffect(() => { fetchItems(); setPage(1); }, [fetchItems]);
  useEffect(() => { fetchCounts(); }, [fetchCounts]);

  const filtered = useMemo(() => {
    setPage(1);
    if (!query) return items;
    const q = query.toLowerCase();
    return items.filter(
      (i) =>
        i.title?.toLowerCase().includes(q) ||
        i.body?.toLowerCase().includes(q) ||
        i.author?.toLowerCase().includes(q)
    );
  }, [items, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const displayItems = useMemo(
    () =>
      paginated.map((item) => ({
        ...item,
        threadIngested: item.threadIngested || sessionIngestedUrls.has(item.url ?? ""),
      })),
    [paginated, sessionIngestedUrls]
  );


  return (
    <>
      <header className="topbar">
        <div>
          <div className="eyebrow">Part 1 · Ingestion</div>
          <h1 className="page-title">Raw feed</h1>
          <p className="page-desc">Every item collected across all platforms, freshest first.</p>
        </div>
        <div className="topbar-actions">
          <label className="search">
            <span className="search-icon">⌕</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search feed…"
            />
            <span className="kbd kbd-soft">/</span>
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button className="btn" onClick={runEmbed} disabled={embedRunning}>
              {embedRunning ? "Embedding…" : "Run Embed"}
            </button>
            {embedResult && (
              <span style={{ fontSize: 12, color: "var(--ink-40)", whiteSpace: "nowrap" }}>{embedResult}</span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button className="btn" onClick={runCluster} disabled={clusterRunning}>
              {clusterRunning ? "Clustering…" : "Run Cluster"}
            </button>
            {clusterResult && (
              <span style={{ fontSize: 12, color: "var(--ink-40)", whiteSpace: "nowrap" }}>{clusterResult}</span>
            )}
          </div>
          <button className="btn btn-ghost" onClick={() => setThreadDialogOpen(true)}>+ Ingest thread</button>
          <a href="/analyst/submit" className="btn btn-primary">+ Submit</a>
        </div>
      </header>

      <div className="page">
        <div className="kpi-row">
          <div className="kpi">
            <div className="kpi-top">
              <div className="kpi-label">Total items</div>
              <Sparkline values={totalSpark} color="var(--ink-40)" />
            </div>
            <div className="kpi-mid">
              <div className="kpi-value">{platformCounts.all}</div>
              <div className="kpi-delta kpi-delta-up">▲ ingested</div>
            </div>
          </div>
          <div className="kpi">
            <div className="kpi-top">
              <div className="kpi-label">Tracked entities</div>
            </div>
            <div className="kpi-mid">
              <div className="kpi-value">{entities.length}</div>
              <div className="kpi-delta kpi-delta-flat">→ configured</div>
            </div>
          </div>
          <div className="kpi">
            <div className="kpi-top">
              <div className="kpi-label">Cron status</div>
            </div>
            <div className="kpi-mid">
              <div className="kpi-value" style={{ fontSize: 20, marginTop: 4 }}>
                <Dot color="var(--ok)" pulse size={10} />
              </div>
              <div className="kpi-delta kpi-delta-up">▲ Healthy</div>
            </div>
            <div className="kpi-sub">Polls every hour</div>
          </div>
        </div>

        <div className="toolbar">
          <div className="filter-group">
            <span className="filter-label">Platform</span>
            <div className="seg seg-mono">
              <button
                className={cx("seg-btn", platform === "all" && "seg-btn-on")}
                onClick={() => setPlatform("all")}
              >
                All <span className="seg-count">{platformCounts.all}</span>
              </button>
              {Object.entries(PLATFORMS).map(([k, p]) => (
                <button
                  key={k}
                  className={cx("seg-btn", platform === k && "seg-btn-on")}
                  onClick={() => setPlatform(k)}
                >
                  <span
                    className="seg-pdot"
                    style={{ background: `oklch(0.62 0.16 ${p.hue})` }}
                  />
                  {p.label}{" "}
                  <span className="seg-count">{platformCounts[k] ?? 0}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="filter-group filter-group-right">
            <select
              className="select"
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
            >
              <option value="all">All entities ({entities.length})</option>
              {entities.map((e) => (
                <option key={e.id} value={e.id}>{e.label}</option>
              ))}
            </select>
            <div className="seg">
              <button
                className={cx("seg-btn", view === "list" && "seg-btn-on")}
                onClick={() => setView("list")}
              >
                List
              </button>
              <button
                className={cx("seg-btn", view === "table" && "seg-btn-on")}
                onClick={() => setView("table")}
              >
                Table
              </button>
            </div>
          </div>
        </div>

        <div className="result-meta">
          <span>
            <strong>{filtered.length}</strong> of {items.length} items
          </span>
          <span className="dim">·</span>
          <span className="dim">Deduplicated on ingest · sorted by recency</span>
          <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            <span className="dim">Show</span>
            <div className="seg">
              {[25, 50, 100].map((n) => (
                <button
                  key={n}
                  className={cx("seg-btn", pageSize === n && "seg-btn-on")}
                  onClick={() => { setPageSize(n); setPage(1); }}
                >
                  {n}
                </button>
              ))}
            </div>
          </span>
        </div>

        {loading ? (
          <div className="empty">
            <div className="empty-mark">…</div>
            <div className="empty-title">Loading feed</div>
          </div>
        ) : view === "list" ? (
          <FeedList items={displayItems} entities={entities} onIngestThread={(url) => setThreadDialogUrl(url)} />
        ) : (
          <FeedTable items={displayItems} entities={entities} />
        )}

        {!loading && filtered.length > 0 && (
          <div className="result-meta" style={{ marginTop: 12, justifyContent: "center", gap: 12 }}>
            <button
              className="btn btn-sm"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              ← Prev
            </button>
            <span>
              Page <strong>{safePage}</strong> of <strong>{totalPages}</strong>
            </span>
            <button
              className="btn btn-sm"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next →
            </button>
          </div>
        )}
      </div>

      {(threadDialogOpen || threadDialogUrl !== null) && activeCompanyId && (
        <ThreadIngestDialog
          companyId={activeCompanyId}
          entities={entities}
          defaultUrl={threadDialogUrl ?? ""}
          onClose={() => { setThreadDialogOpen(false); setThreadDialogUrl(null); }}
          onInserted={() => {
            if (threadDialogUrl) {
              setSessionIngestedUrls((prev) => new Set([...prev, threadDialogUrl]));
            }
            setThreadDialogOpen(false);
            setThreadDialogUrl(null);
            fetchItems();
          }}
        />
      )}
    </>
  );
}

function FeedList({ items, entities, onIngestThread }: { items: FeedItem[]; entities: Entity[]; onIngestThread?: (url: string) => void }) {
  if (items.length === 0) return <Empty />;
  return (
    <div className="feedlist">
      {items.map((item) => (
        <FeedRow key={item.id} item={item} entities={entities} onIngestThread={onIngestThread} />
      ))}
    </div>
  );
}

function hnHref(item: FeedItem): string | null {
  if (item.platform === "hackernews" && item.externalId)
    return `https://news.ycombinator.com/item?id=${item.externalId}`;
  return item.url;
}

function FeedRow({ item, entities, onIngestThread }: { item: FeedItem; entities: Entity[]; onIngestThread?: (url: string) => void }) {
  const ent = entities.find((e) => e.id === item.entityId);
  const sentiment = 0;
  const isRedditPost = item.platform === "reddit" && item.subtype === "reddit_post";
  const alreadyIngested = item.threadIngested ?? false;
  return (
    <article className="feedrow feedrow-low">
      <div className="feedrow-rail" />
      <div className="feedrow-left">
        <PlatformChip platform={item.platform} />
        {item.platform === "hackernews" && (
          <span className={cx("subtype-chip", item.subtype === "comment" ? "subtype-comment" : "subtype-story")}>
            {item.subtype === "comment" ? "Comment" : "Story"}
          </span>
        )}
        <div className="feedrow-time">{relativeTime(item.publishedAt ?? item.createdAt)}</div>
      </div>
      <div className="feedrow-body">
        <div className="feedrow-head">
          <h3 className="feedrow-title">
            {hnHref(item) ? (
              <a href={hnHref(item)!} target="_blank" rel="noopener noreferrer">
                {item.title ?? item.body?.slice(0, 120) ?? "(no title)"}
              </a>
            ) : (
              item.title ?? item.body?.slice(0, 120) ?? "(no title)"
            )}
          </h3>
          <SignalTag level="low" />
        </div>
        {item.body && item.title && (
          <p className="feedrow-snippet">{item.body}</p>
        )}
        <div className="feedrow-meta">
          {item.author && <span className="meta-mono">{item.author}</span>}
          {ent && <EntityBadge label={ent.label} type={ent.entityType} />}
          <span className="meta-sent">
            <span className="meta-sent-label">sentiment</span>
            <SentimentBar value={sentiment} />
            <span className="meta-mono dim">{sentiment.toFixed(2)}</span>
          </span>
        </div>
      </div>
      <div className="feedrow-actions">
        {item.clusterId && (
          <a
            href="/analyst/clusters"
            className="btn btn-ghost btn-sm"
            style={{ fontSize: 11 }}
            title={item.clusterLabel ? `Cluster: ${item.clusterLabel}` : "View cluster"}
          >
            → cluster
          </a>
        )}
        {isRedditPost && item.url && (
          <button
            className={cx("btn btn-ghost btn-sm", alreadyIngested && "btn-muted")}
            disabled={alreadyIngested}
            onClick={() => !alreadyIngested && onIngestThread?.(item.url!)}
            title={alreadyIngested ? "Thread already ingested" : "Ingest thread comments"}
            style={{ fontSize: 11, opacity: alreadyIngested ? 0.45 : 1 }}
          >
            {alreadyIngested ? "Thread ingested" : "≡ Ingest thread"}
          </button>
        )}
        <button className="iconbtn" title="Star">☆</button>
        {hnHref(item) && (
          <a className="iconbtn" href={hnHref(item)!} target="_blank" rel="noopener noreferrer" title="Open">↗</a>
        )}
      </div>
    </article>
  );
}

function FeedTable({ items, entities }: { items: FeedItem[]; entities: Entity[] }) {
  if (items.length === 0) return <Empty />;
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th style={{ width: 70 }}>Src</th>
            <th style={{ width: 80 }}>Time</th>
            <th>Title</th>
            <th style={{ width: 200 }}>Entity</th>
            <th style={{ width: 120 }}>Sentiment</th>
            <th style={{ width: 90 }}>Class</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => {
            const ent = entities.find((e) => e.id === i.entityId);
            return (
              <tr key={i.id}>
                <td>
                  <PlatformChip platform={i.platform} />
                  {i.platform === "hackernews" && (
                    <span className={cx("subtype-chip", i.subtype === "comment" ? "subtype-comment" : "subtype-story")}>
                      {i.subtype === "comment" ? "Cmt" : "Str"}
                    </span>
                  )}
                </td>
                <td className="mono dim">{relativeTime(i.publishedAt ?? i.createdAt)}</td>
                <td className="tbl-title">
                  {hnHref(i) ? (
                    <a href={hnHref(i)!} target="_blank" rel="noopener noreferrer">
                      {i.title ?? i.body?.slice(0, 80) ?? "(no title)"}
                    </a>
                  ) : (
                    i.title ?? "(no title)"
                  )}
                </td>
                <td>{ent && <EntityBadge label={ent.label} type={ent.entityType} />}</td>
                <td><SentimentBar value={0} /></td>
                <td><SignalTag level="low" /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Empty() {
  return (
    <div className="empty">
      <div className="empty-mark">∅</div>
      <div className="empty-title">Nothing here yet</div>
      <div className="empty-sub">
        Add entities in{" "}
        <a href="/analyst/track" className="ulink">Track</a>, configure sources in{" "}
        <a href="/analyst/sources" className="ulink">Sources</a>, or{" "}
        <a href="/analyst/submit" className="ulink">submit manually</a>.
      </div>
    </div>
  );
}
