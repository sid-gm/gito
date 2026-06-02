"use client";

import { useEffect, useState } from "react";
import { cx, Dot, PlatformChip, Sparkline } from "@/components/primitives";
import { useCompany } from "@/components/CompanyContext";
import ThreadIngestDialog from "@/components/ThreadIngestDialog";

type EnvStatus = { hackernews: boolean; twitter: boolean; threads: boolean; reddit: boolean };

type SourceStats = { today: number; sevenDays: number; lastPoll: string | null };
type GAStats = SourceStats;
type HNStats = SourceStats;
type TwitterStats = SourceStats;
type ThreadsStats = SourceStats;
type RedditStats = SourceStats;

type RedditSubreddit = { id: string; subredditName: string; keywordFilters: string[]; createdAt: string };

type ThreadsFilter = { id: string; filterType: "keyword" | "user"; value: string };
type Entity = { id: string; label: string };

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

type SourceDef = {
  key: string;
  name: string;
  desc: string;
  requiresEnv: string[];
  note?: string;
};

const SOURCE_DEFS: SourceDef[] = [
  {
    key: "hackernews",
    name: "HackerNews",
    desc: "Algolia HN search API — free, no credentials required. Searches stories and comments across all of HN.",
    requiresEnv: [],
  },
  {
    key: "twitter",
    name: "X / Twitter",
    desc: "Twitter API v2 recent search. Supports boolean queries and from: handle syntax for executives.",
    requiresEnv: ["TWITTER_BEARER_TOKEN"],
    note: "Basic tier ($100/mo) recommended for useful volume. Free tier is heavily rate-limited.",
  },
  {
    key: "google_alerts",
    name: "Google Alerts",
    desc: "Parses RSS feeds you configure in Google Alerts. Add a feed URL to each tracked entity in the Track page.",
    requiresEnv: [],
  },
  {
    key: "threads",
    name: "Threads",
    desc: "Meta Threads Graph API. Track posts by keyword search or specific user accounts. Requires a long-lived user access token with threads_basic and threads_keyword_search scopes.",
    requiresEnv: ["THREADS_ACCESS_TOKEN"],
  },
  {
    key: "reddit",
    name: "Reddit RSS",
    desc: "Tracks new posts from configured subreddits via public RSS feeds. No credentials required.",
    requiresEnv: [],
  },
  {
    key: "manual",
    name: "Manual",
    desc: "Analyst submits articles directly via the Submit page. Always active — no configuration needed.",
    requiresEnv: [],
  },
];

function fillSeries(
  sparse: { date: string; count: number }[],
  slots: number,
  stepMs: number
): number[] {
  const map = new Map(sparse.map((r) => [r.date, r.count]));
  const now = Date.now();
  return Array.from({ length: slots }, (_, i) => {
    const t = new Date(now - (slots - 1 - i) * stepMs);
    const key = stepMs >= 86400000
      ? t.toISOString().slice(0, 10)
      : `${t.toISOString().slice(0, 13).replace("T", " ")}:00`;
    return map.get(key) ?? 0;
  });
}

export default function SourcesPage() {
  const { activeCompanyId } = useCompany();
  const [envStatus, setEnvStatus] = useState<EnvStatus | null>(null);
  const [alertCount, setAlertCount] = useState(0);
  const [pollStatus, setPollStatus] = useState<Record<string, "idle" | "polling" | { inserted: number } | "error">>({});
  const [gaStats, setGaStats] = useState<GAStats | null>(null);
  const [hnStats, setHnStats] = useState<HNStats | null>(null);
  const [twitterStats, setTwitterStats] = useState<TwitterStats | null>(null);
  const [threadsStats, setThreadsStats] = useState<ThreadsStats | null>(null);
  const [threadsFilters, setThreadsFilters] = useState<ThreadsFilter[]>([]);
  const [threadsInput, setThreadsInput] = useState("");
  const [threadsFilterType, setThreadsFilterType] = useState<"keyword" | "user">("keyword");
  const [sourceSparklines, setSourceSparklines] = useState<Record<string, number[]>>({});
  const [entities, setEntities] = useState<Entity[]>([]);
  const [threadDialogOpen, setThreadDialogOpen] = useState(false);
  const [redditStats, setRedditStats] = useState<RedditStats | null>(null);
  const [redditSubreddits, setRedditSubreddits] = useState<RedditSubreddit[]>([]);
  const [redditInput, setRedditInput] = useState("");
  const [redditKeywordInput, setRedditKeywordInput] = useState("");
  const [redditEditingId, setRedditEditingId] = useState<string | null>(null);
  const [redditEditKeywords, setRedditEditKeywords] = useState("");

  useEffect(() => {
    if (!activeCompanyId) return;

    fetch("/api/sources/status").then((r) => r.json()).then(setEnvStatus);
    fetch(`/api/entities?companyId=${activeCompanyId}`)
      .then((r) => r.json())
      .then((rows: { id: string; label: string; googleAlertsFeedUrl: string | null }[]) => {
        setAlertCount(rows.filter((e) => e.googleAlertsFeedUrl).length);
        setEntities(rows.map((e) => ({ id: e.id, label: e.label })));
      });
    fetch(`/api/threads-filters?companyId=${activeCompanyId}`)
      .then((r) => r.json())
      .then((rows: ThreadsFilter[]) => setThreadsFilters(rows));
    fetch(`/api/reddit-subreddits?companyId=${activeCompanyId}`)
      .then((r) => r.json())
      .then((rows: RedditSubreddit[]) => setRedditSubreddits(rows));

    const refreshStats = () => {
      const cq = `companyId=${activeCompanyId}`;
      fetch(`/api/sources/stats/google-alerts?${cq}`).then((r) => r.json()).then(setGaStats);
      fetch(`/api/sources/stats/hackernews?${cq}`).then((r) => r.json()).then(setHnStats);
      fetch(`/api/sources/stats/twitter?${cq}`).then((r) => r.json()).then(setTwitterStats);
      fetch(`/api/sources/stats/threads?${cq}`).then((r) => r.json()).then(setThreadsStats);
      fetch(`/api/sources/stats/reddit?${cq}`).then((r) => r.json()).then(setRedditStats);

      const platforms = ["hackernews", "twitter", "google_alerts", "manual", "threads", "reddit"];
      Promise.all(
        platforms.map((p) =>
          fetch(`/api/items/timeseries?platform=${p}&groupBy=hour&days=1&${cq}`)
            .then((r) => r.json())
            .then((d) => [p, fillSeries(d.series, 24, 3600000)] as const)
        )
      ).then((entries) => setSourceSparklines(Object.fromEntries(entries)));
    };

    refreshStats();
    const interval = setInterval(refreshStats, 60_000);
    return () => clearInterval(interval);
  }, [activeCompanyId]);

  async function addThreadsFilter() {
    const value = threadsInput.trim().replace(/^[@#]/, "");
    if (!value || !activeCompanyId) return;
    const res = await fetch("/api/threads-filters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filterType: threadsFilterType, value, companyId: activeCompanyId }),
    });
    if (res.ok) {
      const row = await res.json() as ThreadsFilter;
      setThreadsFilters((prev) => prev.some((f) => f.id === row.id) ? prev : [...prev, row]);
      setThreadsInput("");
    }
  }

  async function addRedditSubreddit() {
    if (!activeCompanyId) return;
    const name = redditInput.trim().replace(/^r\//, "").toLowerCase();
    const keywords = redditKeywordInput
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    // Need at least a subreddit name or some keywords to track
    if (!name && keywords.length === 0) return;
    const subredditName = name || "all";
    const res = await fetch("/api/reddit-subreddits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subredditName, keywordFilters: keywords, companyId: activeCompanyId }),
    });
    if (res.status === 409 && subredditName === "all") {
      // Merge new keywords into the existing "all" entry
      const existing = redditSubreddits.find((r) => r.subredditName === "all");
      if (existing) {
        const merged = [...new Set([...existing.keywordFilters, ...keywords])];
        const cq = `?companyId=${activeCompanyId}`;
        const patchRes = await fetch(`/api/reddit-subreddits/${existing.id}${cq}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keywordFilters: merged }),
        });
        if (patchRes.ok) {
          const row = await patchRes.json() as RedditSubreddit;
          setRedditSubreddits((prev) => prev.map((r) => (r.id === existing.id ? row : r)));
          setRedditInput("");
          setRedditKeywordInput("");
        }
      }
      return;
    }
    if (res.ok) {
      const row = await res.json() as RedditSubreddit;
      setRedditSubreddits((prev) => prev.some((r) => r.id === row.id) ? prev : [...prev, row]);
      setRedditInput("");
      setRedditKeywordInput("");
    }
  }

  async function removeRedditSubreddit(id: string) {
    const cq = activeCompanyId ? `?companyId=${activeCompanyId}` : "";
    await fetch(`/api/reddit-subreddits/${id}${cq}`, { method: "DELETE" });
    setRedditSubreddits((prev) => prev.filter((r) => r.id !== id));
  }

  async function saveRedditKeywords(id: string) {
    const keywords = redditEditKeywords.split(",").map((k) => k.trim()).filter(Boolean);
    const cq = activeCompanyId ? `?companyId=${activeCompanyId}` : "";
    const res = await fetch(`/api/reddit-subreddits/${id}${cq}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keywordFilters: keywords }),
    });
    if (res.ok) {
      const row = await res.json() as RedditSubreddit;
      setRedditSubreddits((prev) => prev.map((r) => r.id === id ? row : r));
      setRedditEditingId(null);
      setRedditEditKeywords("");
    }
  }

  async function removeThreadsFilter(id: string) {
    const cq = activeCompanyId ? `?companyId=${activeCompanyId}` : "";
    await fetch(`/api/threads-filters/${id}${cq}`, { method: "DELETE" });
    setThreadsFilters((prev) => prev.filter((f) => f.id !== id));
  }

  const isConnected = (key: string) => {
    if (key === "hackernews" || key === "manual") return "active";
    if (key === "google_alerts") return alertCount > 0 ? "active" : "offline";
    if (key === "twitter") return envStatus?.twitter ? "active" : "offline";
    if (key === "reddit") return redditSubreddits.length > 0 ? "active" : "degraded";
    if (key === "threads") {
      if (!envStatus?.threads) return "offline";
      return threadsFilters.length > 0 ? "active" : "degraded";
    }
    return "offline";
  };

  async function pollSource(key: string) {
    const endpoint =
      key === "google_alerts" ? "/api/sources/poll/google-alerts"
      : key === "hackernews" ? "/api/sources/poll/hackernews"
      : key === "twitter" ? "/api/sources/poll/twitter"
      : key === "threads" ? "/api/sources/poll/threads"
      : null;
    if (!endpoint) return;

    setPollStatus((s) => ({ ...s, [key]: "polling" }));
    try {
      const res = await fetch(endpoint, { method: "POST" });
      const data = await res.json();
      setPollStatus((s) => ({ ...s, [key]: { inserted: data.inserted ?? 0 } }));
      const cq = activeCompanyId ? `?companyId=${activeCompanyId}` : "";
      if (key === "hackernews") fetch(`/api/sources/stats/hackernews${cq}`).then((r) => r.json()).then(setHnStats);
      if (key === "twitter") fetch(`/api/sources/stats/twitter${cq}`).then((r) => r.json()).then(setTwitterStats);
    } catch {
      setPollStatus((s) => ({ ...s, [key]: "error" }));
    }
  }

  const now = new Date();
  const nextPollMin = 60 - now.getMinutes();

  return (
    <>
      <header className="topbar">
        <div>
          <div className="eyebrow">Part 1 · Ingestion</div>
          <h1 className="page-title">Sources</h1>
          <p className="page-desc">Platform health, polling cadence and credentials.</p>
        </div>
        <div className="topbar-actions">
          <button
            className="btn btn-primary btn-sm"
            onClick={() => setThreadDialogOpen(true)}
          >
            + Ingest thread
          </button>
          <div className="seg">
            {["1h", "24h", "7d"].map((r) => (
              <button key={r} className="seg-btn">{r}</button>
            ))}
          </div>
        </div>
      </header>

      <div className="page">
        <div className="src-grid">
          {SOURCE_DEFS.map((s) => {
            const status = isConnected(s.key) as "active" | "degraded" | "offline";
            const tone = status === "active" ? "ok" : status === "degraded" ? "warn" : "err";
            const spark = sourceSparklines[s.key] ?? [];

            const statsToday =
              s.key === "google_alerts" ? (gaStats ? gaStats.today : "—")
              : s.key === "hackernews" ? (hnStats ? hnStats.today : "—")
              : s.key === "twitter" ? (twitterStats ? twitterStats.today : "—")
              : s.key === "threads" ? (threadsStats ? threadsStats.today : "—")
              : s.key === "reddit" ? (redditStats ? redditStats.today : "—")
              : "—";
            const statsSevenDays =
              s.key === "google_alerts" ? (gaStats ? gaStats.sevenDays : "—")
              : s.key === "hackernews" ? (hnStats ? hnStats.sevenDays : "—")
              : s.key === "twitter" ? (twitterStats ? twitterStats.sevenDays : "—")
              : s.key === "threads" ? (threadsStats ? threadsStats.sevenDays : "—")
              : s.key === "reddit" ? (redditStats ? redditStats.sevenDays : "—")
              : "—";
            const statsLastPoll =
              s.key === "google_alerts" ? relativeTime(gaStats?.lastPoll ?? null)
              : s.key === "hackernews" ? relativeTime(hnStats?.lastPoll ?? null)
              : s.key === "twitter" ? relativeTime(twitterStats?.lastPoll ?? null)
              : s.key === "threads" ? relativeTime(threadsStats?.lastPoll ?? null)
              : s.key === "reddit" ? relativeTime(redditStats?.lastPoll ?? null)
              : "—";

            const ps = pollStatus[s.key] ?? "idle";
            const polling = ps === "polling";
            const pollLabel = ps === "polling"
              ? "Polling…"
              : ps === "error"
              ? "Error"
              : typeof ps === "object"
              ? ps.inserted > 0 ? `✓ ${ps.inserted} new` : "✓ Up to date"
              : "↻ Poll now";
            const canPoll = s.key === "google_alerts" || s.key === "hackernews" || s.key === "twitter" || s.key === "threads";

            return (
              <div key={s.key} className={cx("scard", `scard-${tone}`)}>
                <div className="scard-head">
                  <div className="scard-id">
                    <PlatformChip platform={s.key} size="lg" />
                  </div>
                  <div className={cx("status-pill", `status-${tone}`)}>
                    <Dot color={`var(--${tone})`} pulse={tone === "ok"} />
                    {status === "active" ? "Active" : status === "degraded" ? "Degraded" : "Not configured"}
                  </div>
                </div>

                <h3 className="scard-name">{s.name}</h3>
                <p className="scard-desc">{s.desc}</p>

                {s.note && (
                  <div className="scard-note">
                    <span className="scard-note-mark">!</span>
                    <span>{s.note}</span>
                  </div>
                )}

                <div className="scard-stats">
                  <div>
                    <div className="scard-stat-label">Today</div>
                    <div className="scard-stat-value">{statsToday}</div>
                  </div>
                  <div>
                    <div className="scard-stat-label">7 days</div>
                    <div className="scard-stat-value">{statsSevenDays}</div>
                  </div>
                  <div>
                    <div className="scard-stat-label">Last poll</div>
                    <div className="scard-stat-value mono">{statsLastPoll}</div>
                  </div>
                </div>

                <div className="scard-spark">
                  <Sparkline values={spark} color={`var(--${tone})`} height={32} fill />
                  <span className="scard-spark-hint">24h ingest</span>
                </div>

                {s.requiresEnv.length > 0 && (
                  <div className="scard-env">
                    <div className="scard-env-label">Required env</div>
                    <div className="scard-env-list">
                      {s.requiresEnv.map((v) => (
                        <code key={v} className="codepill">
                          <span className={cx("env-dot", tone === "ok" ? "env-dot-ok" : "env-dot-err")} />
                          {v}
                        </code>
                      ))}
                    </div>
                  </div>
                )}

                {s.key === "google_alerts" && (
                  <div className="scard-env">
                    <div className="scard-env-label">RSS feeds configured</div>
                    <div style={{ fontSize: 13, color: "var(--ink-80)" }}>
                      {alertCount > 0 ? (
                        <span style={{ color: "var(--ok)" }}>{alertCount} entity {alertCount === 1 ? "feed" : "feeds"} active</span>
                      ) : (
                        <span className="dim">None — add a feed URL to a tracked entity</span>
                      )}
                    </div>
                  </div>
                )}

                {s.key === "threads" && (
                  <div className="scard-env">
                    <div className="scard-env-label">Tracked filters</div>
                    <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
                      {(["keyword", "user"] as const).map((type) => (
                        <button
                          key={type}
                          className={cx("btn btn-ghost btn-sm", threadsFilterType === type && "btn-active")}
                          onClick={() => setThreadsFilterType(type)}
                          style={{ textTransform: "capitalize" }}
                        >
                          {type === "keyword" ? "# Keywords" : "@ Users"}
                        </button>
                      ))}
                    </div>
                    {threadsFilters.length > 0 && (
                      <div className="scard-env-list" style={{ marginBottom: 6 }}>
                        {threadsFilters
                          .filter((f) => f.filterType === threadsFilterType)
                          .map((f) => (
                            <span key={f.id} className="codepill" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                              {f.filterType === "user" ? "@" : "#"}{f.value}
                              <button
                                onClick={() => removeThreadsFilter(f.id)}
                                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-40)", lineHeight: 1, padding: 0, fontSize: 12 }}
                                aria-label={`Remove ${f.value}`}
                              >
                                ×
                              </button>
                            </span>
                          ))}
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 6 }}>
                      <input
                        type="text"
                        value={threadsInput}
                        onChange={(e) => setThreadsInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && addThreadsFilter()}
                        placeholder={threadsFilterType === "user" ? "username (no @)" : "keyword or phrase"}
                        style={{
                          flex: 1,
                          fontSize: 12,
                          padding: "3px 8px",
                          background: "var(--surface-1)",
                          border: "1px solid var(--border)",
                          borderRadius: 4,
                          color: "var(--ink-100)",
                        }}
                      />
                      <button className="btn btn-ghost btn-sm" onClick={addThreadsFilter}>
                        Add
                      </button>
                    </div>
                  </div>
                )}

                {s.key === "reddit" && (
                  <div className="scard-env">
                    <div className="scard-env-label">Tracked subreddits</div>
                    {redditSubreddits.length > 0 && (
                      <div style={{ marginBottom: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                        {redditSubreddits.map((sub) => (
                          <div key={sub.id} style={{ fontSize: 12 }}>
                            {redditEditingId === sub.id ? (
                              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                <div style={{ fontWeight: 600, color: "var(--ink-80)" }}>
                                  {sub.subredditName === "all" ? "All of Reddit" : `r/${sub.subredditName}`}
                                </div>
                                <input
                                  type="text"
                                  value={redditEditKeywords}
                                  onChange={(e) => setRedditEditKeywords(e.target.value)}
                                  onKeyDown={(e) => e.key === "Enter" && saveRedditKeywords(sub.id)}
                                  placeholder="keyword1, keyword2 (empty = all posts)"
                                  style={{
                                    fontSize: 12,
                                    padding: "3px 8px",
                                    background: "var(--surface-1)",
                                    border: "1px solid var(--border)",
                                    borderRadius: 4,
                                    color: "var(--ink-100)",
                                  }}
                                />
                                <div style={{ display: "flex", gap: 4 }}>
                                  <button className="btn btn-ghost btn-sm" onClick={() => saveRedditKeywords(sub.id)}>Save</button>
                                  <button className="btn btn-ghost btn-sm" onClick={() => { setRedditEditingId(null); setRedditEditKeywords(""); }}>Cancel</button>
                                </div>
                              </div>
                            ) : (
                              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                <span style={{ fontWeight: 600, color: "var(--ink-80)", flexShrink: 0 }}>
                                  {sub.subredditName === "all" ? "All of Reddit" : `r/${sub.subredditName}`}
                                </span>
                                {sub.keywordFilters.length === 0 ? (
                                  <span className="codepill" style={{ color: "var(--ink-40)" }}>All posts</span>
                                ) : (
                                  sub.keywordFilters.map((kw) => (
                                    <span key={kw} className="codepill">{kw}</span>
                                  ))
                                )}
                                <button
                                  onClick={() => { setRedditEditingId(sub.id); setRedditEditKeywords(sub.keywordFilters.join(", ")); }}
                                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-40)", fontSize: 11, padding: "1px 4px" }}
                                >
                                  Edit
                                </button>
                                <button
                                  onClick={() => removeRedditSubreddit(sub.id)}
                                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-40)", fontSize: 12, padding: 0, lineHeight: 1 }}
                                  aria-label={`Remove r/${sub.subredditName}`}
                                >
                                  ×
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <input
                        type="text"
                        value={redditInput}
                        onChange={(e) => setRedditInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && addRedditSubreddit()}
                        placeholder="subreddit (optional — blank tracks all of Reddit)"
                        style={{
                          fontSize: 12,
                          padding: "3px 8px",
                          background: "var(--surface-1)",
                          border: "1px solid var(--border)",
                          borderRadius: 4,
                          color: "var(--ink-100)",
                        }}
                      />
                      <div style={{ display: "flex", gap: 6 }}>
                        <input
                          type="text"
                          value={redditKeywordInput}
                          onChange={(e) => setRedditKeywordInput(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && addRedditSubreddit()}
                          placeholder="keywords (optional, comma-separated)"
                          style={{
                            flex: 1,
                            fontSize: 12,
                            padding: "3px 8px",
                            background: "var(--surface-1)",
                            border: "1px solid var(--border)",
                            borderRadius: 4,
                            color: "var(--ink-100)",
                          }}
                        />
                        <button className="btn btn-ghost btn-sm" onClick={addRedditSubreddit}>
                          Add
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                <div className="scard-foot">
                  {canPoll ? (
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => pollSource(s.key)}
                      disabled={polling}
                    >
                      {pollLabel}
                    </button>
                  ) : (
                    <button className="btn btn-ghost btn-sm">↻ Poll now</button>
                  )}
                  <button className="btn btn-ghost btn-sm">View logs</button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="cron-panel">
          <div className="cron-head">
            <div>
              <div className="cron-title">Cron schedule</div>
              <div className="cron-sub">
                All collectors run hourly at minute 0. Vercel Cron hits{" "}
                <code className="codepill">/api/cron/[platform]</code> with the{" "}
                <code className="codepill">CRON_SECRET</code> header.
              </div>
            </div>
            <div className="cron-next">
              <div className="cron-next-label">Next run in</div>
              <div className="cron-next-time">{nextPollMin}m</div>
            </div>
          </div>

          <div className="cron-strip">
            {Array.from({ length: 24 }).map((_, i) => {
              const hour = (now.getHours() + 1 - 24 + i + 24) % 24;
              const status = i === 23 ? "next" : i > 20 && Math.random() < 0.2 ? "warn" : "ok";
              return (
                <div
                  key={i}
                  className={cx("cron-tick", `cron-tick-${status}`)}
                  title={`${hour.toString().padStart(2, "0")}:00 — ${status}`}
                >
                  <span className="cron-tick-bar" />
                  {i % 6 === 0 && (
                    <span className="cron-tick-label">
                      {hour.toString().padStart(2, "0")}:00
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          <div className="cron-legend">
            <span><Dot color="var(--ok)" /> Successful poll</span>
            <span><Dot color="var(--warn)" /> Partial / rate-limited</span>
            <span><Dot color="var(--err)" /> Failed</span>
            <span><Dot color="var(--ink-40)" /> Scheduled</span>
          </div>
        </div>
      </div>

      {threadDialogOpen && activeCompanyId && (
        <ThreadIngestDialog
          companyId={activeCompanyId}
          entities={entities}
          onClose={() => setThreadDialogOpen(false)}
          onInserted={() => setThreadDialogOpen(false)}
        />
      )}
    </>
  );
}
