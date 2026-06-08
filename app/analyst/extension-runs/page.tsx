"use client";

import { useEffect, useState } from "react";
import { cx, PlatformChip } from "@/components/primitives";
import { useCompany } from "@/components/CompanyContext";

type RunItem = {
  id: string;
  platform: string;
  url: string | null;
  title: string | null;
  body: string | null;
  author: string | null;
  publishedAt: string | null;
  createdAt: string;
  entityLabel: string | null;
  subtype: string | null;
};

type CollectRun = {
  id: string;
  triggeredBy: string;
  ranAt: string;
  searchTerms: string[];
  platforms: string[];
  itemsCollected: number;
  itemsInserted: number;
  items: RunItem[];
};

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatRunTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

function RunCard({ run, defaultOpen }: { run: CollectRun; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="run-card">
      <button className="run-card-header" onClick={() => setOpen((v) => !v)}>
        <div className="run-card-left">
          <span className={cx("run-trigger-badge", run.triggeredBy === "manual" ? "badge-manual" : "badge-auto")}>
            {run.triggeredBy === "manual" ? "Manual" : "Auto"}
          </span>
          <span className="run-time">{formatRunTime(run.ranAt)}</span>
          <span className="run-meta-sep">·</span>
          <span className="run-ago">{relativeTime(run.ranAt)}</span>
        </div>
        <div className="run-card-right">
          <span className="run-stat">
            <strong>{run.itemsInserted}</strong> inserted
          </span>
          {run.itemsCollected > run.itemsInserted && (
            <span className="run-stat dim">{run.itemsCollected} collected</span>
          )}
          <span className="run-chevron">{open ? "▲" : "▼"}</span>
        </div>
      </button>

      <div className="run-terms">
        <span className="run-terms-label">Terms:</span>{" "}
        {run.searchTerms.join(", ")}
        <span className="run-meta-sep">·</span>
        <span className="run-terms-label">Platforms:</span>{" "}
        {run.platforms.map((p) => (p === "twitter" ? "X" : p.charAt(0).toUpperCase() + p.slice(1))).join(", ")}
      </div>

      {open && (
        <div className="run-items">
          {run.items.length === 0 ? (
            <div className="run-empty">No new items — all were duplicates.</div>
          ) : (
            run.items.map((item) => (
              <div key={item.id} className="run-item">
                <div className="run-item-left">
                  <PlatformChip platform={item.platform} />
                  <span className="run-item-time dim">{relativeTime(item.publishedAt ?? item.createdAt)}</span>
                </div>
                <div className="run-item-body">
                  <div className="run-item-title">
                    {item.url ? (
                      <a href={item.url} target="_blank" rel="noopener noreferrer">
                        {item.title ?? item.body?.slice(0, 120) ?? "(no title)"}
                      </a>
                    ) : (
                      item.title ?? item.body?.slice(0, 120) ?? "(no title)"
                    )}
                  </div>
                  <div className="run-item-meta">
                    {item.author && <span className="meta-mono">{item.author}</span>}
                    {item.entityLabel && (
                      <span className="run-item-entity">{item.entityLabel}</span>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function ExtensionRunsPage() {
  const { activeCompanyId } = useCompany();
  const [runs, setRuns] = useState<CollectRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeCompanyId) return;
    setLoading(true);
    fetch(`/api/extension-runs?companyId=${activeCompanyId}`)
      .then((r) => r.json())
      .then((data) => { setRuns(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [activeCompanyId]);

  return (
    <>
      <style>{`
        .run-card {
          background: var(--paper);
          border: 1px solid var(--rule);
          border-radius: 8px;
          margin-bottom: 10px;
          overflow: hidden;
        }
        .run-card-header {
          width: 100%;
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px 14px;
          background: none;
          border: none;
          cursor: pointer;
          text-align: left;
          gap: 8px;
        }
        .run-card-header:hover { background: var(--paper-hover, #f4f2ed); }
        .run-card-left { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
        .run-card-right { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
        .run-trigger-badge {
          font-size: 10px; font-weight: 600; letter-spacing: 0.04em;
          text-transform: uppercase; padding: 2px 7px;
          border-radius: 4px; flex-shrink: 0;
        }
        .badge-auto { background: var(--rule); color: var(--ink-60, #555); }
        .badge-manual { background: var(--ink); color: var(--paper); }
        .run-time { font-size: 13px; font-weight: 500; }
        .run-ago { font-size: 12px; color: var(--ink-40, #888); }
        .run-meta-sep { color: var(--ink-20, #ccc); }
        .run-stat { font-size: 12px; color: var(--ink-60, #555); }
        .run-stat.dim { color: var(--ink-40, #888); }
        .run-chevron { font-size: 9px; color: var(--ink-40, #888); margin-left: 4px; }
        .run-terms {
          font-size: 11px; color: var(--ink-40, #888);
          padding: 0 14px 8px;
          border-bottom: 1px solid var(--rule);
        }
        .run-terms-label { font-weight: 500; color: var(--ink-60, #555); }
        .run-items { padding: 4px 0; }
        .run-item {
          display: flex; gap: 12px;
          padding: 8px 14px;
          border-bottom: 1px solid var(--rule);
        }
        .run-item:last-child { border-bottom: none; }
        .run-item-left { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; width: 80px; flex-shrink: 0; }
        .run-item-time { font-size: 11px; }
        .run-item-body { flex: 1; min-width: 0; }
        .run-item-title { font-size: 13px; line-height: 1.4; margin-bottom: 3px; }
        .run-item-title a { color: inherit; text-decoration: none; }
        .run-item-title a:hover { text-decoration: underline; }
        .run-item-meta { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
        .run-item-entity {
          font-size: 11px; padding: 1px 6px;
          background: var(--rule); border-radius: 4px;
          color: var(--ink-60, #555);
        }
        .run-empty { padding: 12px 14px; font-size: 12px; color: var(--ink-40, #888); font-style: italic; }
      `}</style>

      <header className="topbar">
        <div>
          <div className="eyebrow">Part 1 · Ingestion</div>
          <h1 className="page-title">Extension runs</h1>
          <p className="page-desc">Items ingested by the browser extension's auto-collect and manual runs.</p>
        </div>
      </header>

      <div className="page">
        {loading ? (
          <div className="empty">
            <div className="empty-mark">…</div>
            <div className="empty-title">Loading runs</div>
          </div>
        ) : runs.length === 0 ? (
          <div className="empty">
            <div className="empty-mark">∅</div>
            <div className="empty-title">No runs yet</div>
            <div className="empty-sub">
              Enable auto-collect in the Gito Chrome extension and it will appear here.
            </div>
          </div>
        ) : (
          runs.map((run, i) => (
            <RunCard key={run.id} run={run} defaultOpen={i === 0} />
          ))
        )}
      </div>
    </>
  );
}
