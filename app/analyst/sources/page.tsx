"use client";

import { useEffect, useState, useMemo } from "react";
import { cx, Dot, PlatformChip, Sparkline, Field } from "@/components/primitives";
import { useCompany } from "@/components/CompanyContext";
import ThreadIngestDialog from "@/components/ThreadIngestDialog";

type EnvStatus = { hackernews: boolean; twitter: boolean; reddit: boolean };

type SourceStats = { today: number; sevenDays: number; lastPoll: string | null };
type GAStats = SourceStats;
type HNStats = SourceStats;
type TwitterStats = SourceStats;
type RedditStats = SourceStats;

type RedditSubreddit = { id: string; subredditName: string; keywordFilters: string[]; createdAt: string };
type TwitterHandle = { id: string; handle: string; createdAt: string };
type RssFeed = { id: string; entityId: string; label: string; feedUrl: string; createdAt: string };
type UserHandle = { id: string; platform: string; username: string; createdAt: string };

type Entity = {
  id: string;
  label: string;
  queryString: string;
  entityType: "keyword" | "executive" | "product";
  createdAt: string;
};

const emptyEntityForm = {
  label: "",
  queryString: "",
  entityType: "keyword" as Entity["entityType"],
};

const entityGlyph = (type: Entity["entityType"]) =>
  type === "executive" ? "◉" : type === "product" ? "◧" : "◇";

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
    desc: "Parses RSS feeds you configure in Google Alerts. Add a feed URL per tracked entity below.",
    requiresEnv: [],
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

  // Source health
  const [envStatus, setEnvStatus] = useState<EnvStatus | null>(null);
  const [pollStatus, setPollStatus] = useState<Record<string, "idle" | "polling" | { inserted: number } | "error">>({});
  const [gaStats, setGaStats] = useState<GAStats | null>(null);
  const [hnStats, setHnStats] = useState<HNStats | null>(null);
  const [twitterStats, setTwitterStats] = useState<TwitterStats | null>(null);
  const [sourceSparklines, setSourceSparklines] = useState<Record<string, number[]>>({});
  const [redditStats, setRedditStats] = useState<RedditStats | null>(null);
  const [threadDialogOpen, setThreadDialogOpen] = useState(false);

  // Entities
  const [entities, setEntities] = useState<Entity[]>([]);
  const [entityAddOpen, setEntityAddOpen] = useState(false);
  const [entityForm, setEntityForm] = useState(emptyEntityForm);
  const [entitySaving, setEntitySaving] = useState(false);
  const [entityError, setEntityError] = useState("");
  const [entityEditingId, setEntityEditingId] = useState<string | null>(null);
  const [entityEditForm, setEntityEditForm] = useState({ label: "", entityType: "keyword" as Entity["entityType"], queryString: "" });
  const [entityEditSaving, setEntityEditSaving] = useState(false);
  const [entityEditError, setEntityEditError] = useState("");

  // RSS feeds (Google Alerts)
  const [rssFeeds, setRssFeeds] = useState<RssFeed[]>([]);
  const [feedAddOpen, setFeedAddOpen] = useState(false);
  const [feedForm, setFeedForm] = useState({ entityId: "", label: "", feedUrl: "" });
  const [feedSaving, setFeedSaving] = useState(false);
  const [feedError, setFeedError] = useState("");

  // Twitter/X handles
  const [twitterHandles, setTwitterHandles] = useState<TwitterHandle[]>([]);
  const [twitterInput, setTwitterInput] = useState("");
  const [twitterAddError, setTwitterAddError] = useState("");

  // Reddit
  const [redditSubreddits, setRedditSubreddits] = useState<RedditSubreddit[]>([]);
  const [redditInput, setRedditInput] = useState("");
  const [redditKeywordInput, setRedditKeywordInput] = useState("");
  const [redditEditingId, setRedditEditingId] = useState<string | null>(null);
  const [redditEditKeywords, setRedditEditKeywords] = useState("");

  // Tracked user handles (HN, Reddit, Manual/other platforms)
  const [userHandles, setUserHandles] = useState<UserHandle[]>([]);
  const [hnUserInput, setHnUserInput] = useState("");
  const [hnUserError, setHnUserError] = useState("");
  const [redditUserInput, setRedditUserInput] = useState("");
  const [redditUserError, setRedditUserError] = useState("");
  const [manualUserPlatform, setManualUserPlatform] = useState("");
  const [manualUserUsername, setManualUserUsername] = useState("");
  const [manualUserError, setManualUserError] = useState("");

  // Extension API key
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [apiKeyCopied, setApiKeyCopied] = useState(false);
  const [apiKeyRegenerating, setApiKeyRegenerating] = useState(false);

  const loadEntities = () => {
    if (!activeCompanyId) return;
    fetch(`/api/entities?companyId=${activeCompanyId}`)
      .then((r) => r.json())
      .then((rows: Entity[]) => setEntities(rows));
  };

  const loadApiKey = () => {
    if (!activeCompanyId) return;
    fetch(`/api/companies/api-key?companyId=${activeCompanyId}`)
      .then((r) => r.json())
      .then((d: { apiKey: string }) => setApiKey(d.apiKey));
  };

  const loadRssFeeds = () => {
    if (!activeCompanyId) return;
    fetch(`/api/rss-feeds?companyId=${activeCompanyId}`)
      .then((r) => r.json())
      .then((rows: RssFeed[]) => setRssFeeds(rows));
  };

  const loadTwitterHandles = () => {
    if (!activeCompanyId) return;
    fetch(`/api/twitter-handles?companyId=${activeCompanyId}`)
      .then((r) => r.json())
      .then((rows: TwitterHandle[]) => setTwitterHandles(rows));
  };

  const loadUserHandles = () => {
    if (!activeCompanyId) return;
    fetch(`/api/user-handles?companyId=${activeCompanyId}`)
      .then((r) => r.json())
      .then((rows: UserHandle[]) => setUserHandles(rows));
  };

  useEffect(() => {
    if (!activeCompanyId) return;

    fetch("/api/sources/status").then((r) => r.json()).then(setEnvStatus);
    fetch(`/api/reddit-subreddits?companyId=${activeCompanyId}`)
      .then((r) => r.json())
      .then((rows: RedditSubreddit[]) => setRedditSubreddits(rows));

    loadEntities();
    loadRssFeeds();
    loadTwitterHandles();
    loadUserHandles();
    loadApiKey();

    const refreshStats = () => {
      const cq = `companyId=${activeCompanyId}`;
      fetch(`/api/sources/stats/google-alerts?${cq}`).then((r) => r.json()).then(setGaStats);
      fetch(`/api/sources/stats/hackernews?${cq}`).then((r) => r.json()).then(setHnStats);
      fetch(`/api/sources/stats/twitter?${cq}`).then((r) => r.json()).then(setTwitterStats);
      fetch(`/api/sources/stats/reddit?${cq}`).then((r) => r.json()).then(setRedditStats);

      const platforms = ["hackernews", "twitter", "google_alerts", "manual", "reddit"];
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

  // Entity CRUD
  async function handleEntityAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!activeCompanyId) return;
    setEntitySaving(true);
    setEntityError("");
    const res = await fetch("/api/entities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...entityForm, companyId: activeCompanyId }),
    });
    if (res.ok) {
      setEntityForm(emptyEntityForm);
      setEntityAddOpen(false);
      loadEntities();
    } else {
      setEntityError("Failed to save.");
    }
    setEntitySaving(false);
  }

  async function handleEntityEditSave(id: string) {
    setEntityEditSaving(true);
    setEntityEditError("");
    const res = await fetch(`/api/entities/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: entityEditForm.label,
        queryString: entityEditForm.queryString,
        entityType: entityEditForm.entityType,
      }),
    });
    if (res.ok) {
      setEntityEditingId(null);
      loadEntities();
    } else {
      setEntityEditError("Failed to save changes.");
    }
    setEntityEditSaving(false);
  }

  async function handleEntityDelete(id: string, label: string) {
    if (!window.confirm(`Delete "${label}"? This will remove the entity and all linked clusters. Ingested items will be kept but unlinked.`)) return;
    await fetch(`/api/entities/${id}`, { method: "DELETE" });
    loadEntities();
  }

  // RSS feed CRUD
  async function handleFeedAdd(e: React.FormEvent) {
    e.preventDefault();
    setFeedSaving(true);
    setFeedError("");
    const res = await fetch("/api/rss-feeds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(feedForm),
    });
    if (res.ok) {
      setFeedForm({ entityId: "", label: "", feedUrl: "" });
      setFeedAddOpen(false);
      loadRssFeeds();
    } else {
      const body = await res.json().catch(() => ({}));
      setFeedError(body.error ?? "Failed to add feed.");
    }
    setFeedSaving(false);
  }

  async function handleFeedDelete(id: string) {
    await fetch(`/api/rss-feeds/${id}`, { method: "DELETE" });
    loadRssFeeds();
  }

  // Twitter handle CRUD
  async function handleTwitterAdd() {
    if (!activeCompanyId || !twitterInput.trim()) return;
    setTwitterAddError("");
    const res = await fetch("/api/twitter-handles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ handle: twitterInput.trim(), companyId: activeCompanyId }),
    });
    if (res.ok) {
      const row = await res.json() as TwitterHandle;
      setTwitterHandles((prev) => [...prev, row]);
      setTwitterInput("");
    } else {
      const body = await res.json().catch(() => ({}));
      setTwitterAddError(body.error ?? "Failed to add handle.");
    }
  }

  async function handleTwitterDelete(id: string) {
    const cq = activeCompanyId ? `?companyId=${activeCompanyId}` : "";
    await fetch(`/api/twitter-handles/${id}${cq}`, { method: "DELETE" });
    setTwitterHandles((prev) => prev.filter((h) => h.id !== id));
  }

  // User handles CRUD (HN, Reddit users, Manual/other)
  async function handleAddUserHandle(platform: string, username: string, onSuccess: () => void, onError: (msg: string) => void) {
    if (!activeCompanyId || !username.trim()) return;
    const res = await fetch("/api/user-handles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform, username: username.trim(), companyId: activeCompanyId }),
    });
    if (res.ok) {
      const row = await res.json() as UserHandle;
      setUserHandles((prev) => [...prev, row]);
      onSuccess();
    } else {
      const body = await res.json().catch(() => ({}));
      onError(body.error ?? "Failed to add user");
    }
  }

  async function handleDeleteUserHandle(id: string) {
    const cq = activeCompanyId ? `?companyId=${activeCompanyId}` : "";
    await fetch(`/api/user-handles/${id}${cq}`, { method: "DELETE" });
    setUserHandles((prev) => prev.filter((h) => h.id !== id));
  }

  // Reddit CRUD
  async function addRedditSubreddit() {
    if (!activeCompanyId) return;
    const name = redditInput.trim().replace(/^r\//, "").toLowerCase();
    const keywords = redditKeywordInput.split(",").map((k) => k.trim()).filter(Boolean);
    if (!name && keywords.length === 0) return;
    const subredditName = name || "all";
    const res = await fetch("/api/reddit-subreddits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subredditName, keywordFilters: keywords, companyId: activeCompanyId }),
    });
    if (res.status === 409 && subredditName === "all") {
      const existing = redditSubreddits.find((r) => r.subredditName === "all");
      if (existing) {
        const merged = [...new Set([...existing.keywordFilters, ...keywords])];
        const patchRes = await fetch(`/api/reddit-subreddits/${existing.id}?companyId=${activeCompanyId}`, {
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

  async function handleRegenerateApiKey() {
    if (!activeCompanyId) return;
    if (!window.confirm("Regenerate API key? The old key will stop working immediately.")) return;
    setApiKeyRegenerating(true);
    const res = await fetch(`/api/companies/api-key/regenerate?companyId=${activeCompanyId}`, { method: "POST" });
    if (res.ok) {
      const d = await res.json() as { apiKey: string };
      setApiKey(d.apiKey);
      setApiKeyVisible(true);
    }
    setApiKeyRegenerating(false);
  }

  async function handleCopyApiKey() {
    if (!apiKey) return;
    await navigator.clipboard.writeText(apiKey);
    setApiKeyCopied(true);
    setTimeout(() => setApiKeyCopied(false), 2000);
  }

  // Feeds grouped by entity
  const feedsByEntityId = useMemo(() => {
    const map: Record<string, RssFeed[]> = {};
    for (const f of rssFeeds) {
      if (!map[f.entityId]) map[f.entityId] = [];
      map[f.entityId].push(f);
    }
    return map;
  }, [rssFeeds]);

  const alertCount = rssFeeds.length;

  const isConnected = (key: string) => {
    if (key === "hackernews" || key === "manual") return "active";
    if (key === "google_alerts") return alertCount > 0 ? "active" : "offline";
    if (key === "twitter") return envStatus?.twitter ? "active" : "offline";
    if (key === "reddit") return redditSubreddits.length > 0 ? "active" : "degraded";
    return "offline";
  };

  async function pollSource(key: string) {
    const endpoint =
      key === "google_alerts" ? "/api/sources/poll/google-alerts"
      : key === "hackernews" ? "/api/sources/poll/hackernews"
      : key === "twitter" ? "/api/sources/poll/twitter"
      : key === "reddit" ? "/api/sources/poll/reddit-rss"
      : null;
    if (!endpoint) return;

    setPollStatus((s) => ({ ...s, [key]: "polling" }));
    try {
      const needsBody = key === "reddit";
      const res = await fetch(endpoint, {
        method: "POST",
        ...(needsBody && activeCompanyId
          ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyId: activeCompanyId }) }
          : {}),
      });
      const data = await res.json();
      setPollStatus((s) => ({ ...s, [key]: { inserted: data.inserted ?? 0 } }));
      const cq = activeCompanyId ? `?companyId=${activeCompanyId}` : "";
      if (key === "hackernews") fetch(`/api/sources/stats/hackernews${cq}`).then((r) => r.json()).then(setHnStats);
      if (key === "twitter") fetch(`/api/sources/stats/twitter${cq}`).then((r) => r.json()).then(setTwitterStats);
      if (key === "reddit") fetch(`/api/sources/stats/reddit${cq}`).then((r) => r.json()).then(setRedditStats);
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
        </div>
      </header>

      <div className="page">

        {/* ── Tracked Entities ── */}
        <div className="tbl-wrap" style={{ marginBottom: 32 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Tracked entities</div>
              <div style={{ fontSize: 12, color: "var(--ink-60)" }}>Keywords, products and executives the system monitors.</div>
            </div>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => { setEntityAddOpen((v) => !v); setEntityError(""); }}
            >
              {entityAddOpen ? "✕ Cancel" : "+ Add entity"}
            </button>
          </div>

          {entityAddOpen && (
            <form className="addcard" onSubmit={handleEntityAdd} style={{ marginBottom: 12 }}>
              <div className="addcard-head">
                <span className="kbd">New</span>
                <span>Add a tracked entity. The query runs against every active source on the next hourly poll.</span>
              </div>
              <div className="addcard-grid">
                <Field label="Label" hint="Display name used everywhere">
                  <input
                    className="ipt"
                    placeholder="e.g. Sam Altman — CEO"
                    value={entityForm.label}
                    onChange={(e) => setEntityForm((f) => ({ ...f, label: e.target.value }))}
                    required
                  />
                </Field>
                <Field label="Type">
                  <div className="seg">
                    {(["keyword", "product", "executive"] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        className={cx("seg-btn", entityForm.entityType === t && "seg-btn-on")}
                        onClick={() => setEntityForm((f) => ({ ...f, entityType: t }))}
                      >
                        <span className={`ebadge-glyph eg-${t}`}>{entityGlyph(t)}</span>
                        {t[0].toUpperCase() + t.slice(1)}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field
                  label="Search query"
                  hint='Boolean operators: "exact phrase" OR term1 OR term2 · commas are not supported'
                  full
                >
                  <input
                    className="ipt mono"
                    placeholder='"Sam Altman" OR "sama"'
                    value={entityForm.queryString}
                    onChange={(e) => setEntityForm((f) => ({ ...f, queryString: e.target.value }))}
                    required
                  />
                </Field>
              </div>
              <div className="addcard-foot">
                <div className="addcard-platforms">
                  <span className="dim">Will be polled on:</span>
                  <PlatformChip platform="hackernews" />
                  <PlatformChip platform="twitter" />
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  {entityError && <span style={{ color: "var(--err)", fontSize: 12 }}>{entityError}</span>}
                  <button type="button" className="btn btn-ghost" onClick={() => setEntityAddOpen(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary" disabled={entitySaving}>
                    {entitySaving ? "Adding…" : "Add entity"}
                  </button>
                </div>
              </div>
            </form>
          )}

          <table className="tbl tbl-entities">
            <thead>
              <tr>
                <th style={{ width: 28 }} />
                <th>Entity</th>
                <th style={{ width: 110 }}>Type</th>
                <th>Search query</th>
                <th style={{ width: 100 }}>Added</th>
                <th style={{ width: 100 }} />
              </tr>
            </thead>
            <tbody>
              {entities.map((e) => (
                entityEditingId === e.id ? (
                  <tr key={e.id} className="entity-row">
                    <td />
                    <td>
                      <input
                        className="ipt"
                        value={entityEditForm.label}
                        onChange={(ev) => setEntityEditForm((f) => ({ ...f, label: ev.target.value }))}
                        style={{ fontSize: 12, padding: "3px 8px" }}
                      />
                    </td>
                    <td>
                      <div className="seg" style={{ flexWrap: "wrap", gap: 2 }}>
                        {(["keyword", "product", "executive"] as const).map((t) => (
                          <button
                            key={t}
                            type="button"
                            className={cx("seg-btn", entityEditForm.entityType === t && "seg-btn-on")}
                            onClick={() => setEntityEditForm((f) => ({ ...f, entityType: t }))}
                            style={{ fontSize: 11, padding: "2px 6px" }}
                          >
                            <span className={`ebadge-glyph eg-${t}`}>{entityGlyph(t)}</span>
                            {t[0].toUpperCase() + t.slice(1)}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td>
                      <input
                        className="ipt mono"
                        value={entityEditForm.queryString}
                        onChange={(ev) => setEntityEditForm((f) => ({ ...f, queryString: ev.target.value }))}
                        style={{ fontSize: 12, padding: "3px 8px" }}
                      />
                      {entityEditError && <div style={{ color: "var(--err)", fontSize: 11, marginTop: 2 }}>{entityEditError}</div>}
                    </td>
                    <td />
                    <td>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => handleEntityEditSave(e.id)} disabled={entityEditSaving}>
                          {entityEditSaving ? "…" : "Save"}
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => { setEntityEditingId(null); setEntityEditError(""); }}>
                          Cancel
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={e.id} className="entity-row">
                    <td>
                      <span className={cx("ebadge-glyph", `eg-${e.entityType}`)}>
                        {entityGlyph(e.entityType)}
                      </span>
                    </td>
                    <td className="entity-label">{e.label}</td>
                    <td>
                      <span className={cx("type-pill", `type-${e.entityType}`)}>{e.entityType}</span>
                    </td>
                    <td>
                      <code className="codepill">{e.queryString}</code>
                    </td>
                    <td className="mono dim">{new Date(e.createdAt).toLocaleDateString()}</td>
                    <td>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => {
                            setEntityEditingId(e.id);
                            setEntityEditForm({ label: e.label, entityType: e.entityType, queryString: e.queryString });
                            setEntityEditError("");
                          }}
                        >
                          Edit
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ color: "var(--err)" }}
                          onClick={() => handleEntityDelete(e.id, e.label)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              ))}
            </tbody>
          </table>
          {entities.length === 0 && (
            <div className="empty">
              <div className="empty-mark">∅</div>
              <div className="empty-title">No entities yet</div>
              <div className="empty-sub">Add your first keyword, product, or executive above.</div>
            </div>
          )}
        </div>

        {/* ── Source Cards ── */}
        <div className="src-grid">
          {SOURCE_DEFS.map((s) => {
            const status = isConnected(s.key) as "active" | "degraded" | "offline";
            const tone = status === "active" ? "ok" : status === "degraded" ? "warn" : "err";
            const spark = sourceSparklines[s.key] ?? [];

            const statsToday =
              s.key === "google_alerts" ? (gaStats ? gaStats.today : "—")
              : s.key === "hackernews" ? (hnStats ? hnStats.today : "—")
              : s.key === "twitter" ? (twitterStats ? twitterStats.today : "—")
              : s.key === "reddit" ? (redditStats ? redditStats.today : "—")
              : "—";
            const statsSevenDays =
              s.key === "google_alerts" ? (gaStats ? gaStats.sevenDays : "—")
              : s.key === "hackernews" ? (hnStats ? hnStats.sevenDays : "—")
              : s.key === "twitter" ? (twitterStats ? twitterStats.sevenDays : "—")
              : s.key === "reddit" ? (redditStats ? redditStats.sevenDays : "—")
              : "—";
            const statsLastPoll =
              s.key === "google_alerts" ? relativeTime(gaStats?.lastPoll ?? null)
              : s.key === "hackernews" ? relativeTime(hnStats?.lastPoll ?? null)
              : s.key === "twitter" ? relativeTime(twitterStats?.lastPoll ?? null)
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
            const canPoll = s.key === "google_alerts" || s.key === "hackernews" || s.key === "twitter" || s.key === "reddit";

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

                {/* HackerNews — tracked users */}
                {s.key === "hackernews" && (
                  <div className="scard-env">
                    <div className="scard-env-label">Tracked users</div>
                    {userHandles.filter((h) => h.platform === "hackernews").length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                        {userHandles.filter((h) => h.platform === "hackernews").map((h) => (
                          <div key={h.id} style={{ display: "flex", alignItems: "center", gap: 3, background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 4, padding: "2px 6px", fontSize: 12 }}>
                            <span className="mono">{h.username}</span>
                            <button
                              onClick={() => handleDeleteUserHandle(h.id)}
                              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-40)", fontSize: 13, padding: 0, lineHeight: 1 }}
                              aria-label={`Remove ${h.username}`}
                            >×</button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 6 }}>
                      <input
                        type="text"
                        value={hnUserInput}
                        onChange={(e) => { setHnUserInput(e.target.value); setHnUserError(""); }}
                        onKeyDown={(e) => e.key === "Enter" && handleAddUserHandle("hackernews", hnUserInput, () => setHnUserInput(""), setHnUserError)}
                        placeholder="username"
                        style={{ flex: 1, fontSize: 12, padding: "3px 8px", background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--ink-100)", fontFamily: "var(--font-mono)" }}
                      />
                      <button className="btn btn-ghost btn-sm" onClick={() => handleAddUserHandle("hackernews", hnUserInput, () => setHnUserInput(""), setHnUserError)}>Add</button>
                    </div>
                    {hnUserError && <div style={{ color: "var(--err)", fontSize: 11, marginTop: 4 }}>{hnUserError}</div>}
                  </div>
                )}

                {/* X / Twitter — global handles */}
                {s.key === "twitter" && (
                  <div className="scard-env">
                    <div className="scard-env-label">X accounts</div>
                    {twitterHandles.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                        {twitterHandles.map((h) => (
                          <div key={h.id} style={{ display: "flex", alignItems: "center", gap: 3, background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 4, padding: "2px 6px", fontSize: 12 }}>
                            <span className="mono">@{h.handle}</span>
                            <button
                              onClick={() => handleTwitterDelete(h.id)}
                              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-40)", fontSize: 13, padding: 0, lineHeight: 1 }}
                              aria-label={`Remove @${h.handle}`}
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 6 }}>
                      <input
                        type="text"
                        value={twitterInput}
                        onChange={(e) => setTwitterInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleTwitterAdd()}
                        placeholder="@handle"
                        style={{
                          flex: 1,
                          fontSize: 12,
                          padding: "3px 8px",
                          background: "var(--surface-1)",
                          border: "1px solid var(--border)",
                          borderRadius: 4,
                          color: "var(--ink-100)",
                          fontFamily: "var(--font-mono)",
                        }}
                      />
                      <button className="btn btn-ghost btn-sm" onClick={handleTwitterAdd}>Add</button>
                    </div>
                    {twitterAddError && <div style={{ color: "var(--err)", fontSize: 11, marginTop: 4 }}>{twitterAddError}</div>}
                  </div>
                )}

                {/* Google Alerts — feeds grouped by entity */}
                {s.key === "google_alerts" && (
                  <div className="scard-env">
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                      <div className="scard-env-label" style={{ marginBottom: 0 }}>RSS feeds</div>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => { setFeedAddOpen((v) => !v); setFeedError(""); }}
                      >
                        {feedAddOpen ? "Cancel" : "+ Add feed"}
                      </button>
                    </div>

                    {feedAddOpen && (
                      <form onSubmit={handleFeedAdd} style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10, padding: "8px", background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 4 }}>
                        <select
                          className="ipt"
                          value={feedForm.entityId}
                          onChange={(e) => setFeedForm((f) => ({ ...f, entityId: e.target.value }))}
                          required
                          style={{ fontSize: 12, padding: "3px 8px" }}
                        >
                          <option value="">Select entity…</option>
                          {entities.map((en) => (
                            <option key={en.id} value={en.id}>{en.label}</option>
                          ))}
                        </select>
                        <input
                          className="ipt"
                          placeholder="Label (e.g. Sam Altman)"
                          value={feedForm.label}
                          onChange={(e) => setFeedForm((f) => ({ ...f, label: e.target.value }))}
                          required
                          style={{ fontSize: 12, padding: "3px 8px" }}
                        />
                        <input
                          className="ipt mono"
                          placeholder="https://www.google.com/alerts/feeds/…"
                          value={feedForm.feedUrl}
                          onChange={(e) => setFeedForm((f) => ({ ...f, feedUrl: e.target.value }))}
                          required
                          style={{ fontSize: 12, padding: "3px 8px" }}
                        />
                        {feedError && <div style={{ color: "var(--err)", fontSize: 11 }}>{feedError}</div>}
                        <div style={{ display: "flex", gap: 4 }}>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setFeedAddOpen(false); setFeedError(""); }}>Cancel</button>
                          <button type="submit" className="btn btn-primary btn-sm" disabled={feedSaving}>
                            {feedSaving ? "Saving…" : "Add feed"}
                          </button>
                        </div>
                      </form>
                    )}

                    {entities.filter((en) => feedsByEntityId[en.id]?.length > 0).length === 0 && !feedAddOpen && (
                      <div style={{ fontSize: 12, color: "var(--ink-40)", fontStyle: "italic" }}>
                        None — add a feed URL to a tracked entity above.
                      </div>
                    )}

                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {entities
                        .filter((en) => feedsByEntityId[en.id]?.length > 0)
                        .map((en) => (
                          <div key={en.id}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-60)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                              {en.label}
                            </div>
                            {feedsByEntityId[en.id].map((feed) => (
                              <div key={feed.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", borderBottom: "1px solid var(--border-soft)" }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: 12, fontWeight: 500 }}>{feed.label}</div>
                                  <div style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--ink-40)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{feed.feedUrl}</div>
                                </div>
                                <button
                                  onClick={() => handleFeedDelete(feed.id)}
                                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-40)", fontSize: 13, padding: 0, lineHeight: 1, flexShrink: 0 }}
                                  aria-label="Remove feed"
                                >
                                  ×
                                </button>
                              </div>
                            ))}
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {/* Reddit — tracked users */}
                {s.key === "reddit" && (
                  <div className="scard-env">
                    <div className="scard-env-label">Tracked users</div>
                    {userHandles.filter((h) => h.platform === "reddit").length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                        {userHandles.filter((h) => h.platform === "reddit").map((h) => (
                          <div key={h.id} style={{ display: "flex", alignItems: "center", gap: 3, background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 4, padding: "2px 6px", fontSize: 12 }}>
                            <span className="mono">u/{h.username}</span>
                            <button
                              onClick={() => handleDeleteUserHandle(h.id)}
                              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-40)", fontSize: 13, padding: 0, lineHeight: 1 }}
                              aria-label={`Remove u/${h.username}`}
                            >×</button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 6 }}>
                      <input
                        type="text"
                        value={redditUserInput}
                        onChange={(e) => { setRedditUserInput(e.target.value); setRedditUserError(""); }}
                        onKeyDown={(e) => e.key === "Enter" && handleAddUserHandle("reddit", redditUserInput, () => setRedditUserInput(""), setRedditUserError)}
                        placeholder="u/username"
                        style={{ flex: 1, fontSize: 12, padding: "3px 8px", background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--ink-100)", fontFamily: "var(--font-mono)" }}
                      />
                      <button className="btn btn-ghost btn-sm" onClick={() => handleAddUserHandle("reddit", redditUserInput, () => setRedditUserInput(""), setRedditUserError)}>Add</button>
                    </div>
                    {redditUserError && <div style={{ color: "var(--err)", fontSize: 11, marginTop: 4 }}>{redditUserError}</div>}
                  </div>
                )}

                {/* Reddit — subreddits config */}
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
                                  style={{ fontSize: 12, padding: "3px 8px", background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--ink-100)" }}
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
                                  sub.keywordFilters.map((kw) => <span key={kw} className="codepill">{kw}</span>)
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
                        style={{ fontSize: 12, padding: "3px 8px", background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--ink-100)" }}
                      />
                      <div style={{ display: "flex", gap: 6 }}>
                        <input
                          type="text"
                          value={redditKeywordInput}
                          onChange={(e) => setRedditKeywordInput(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && addRedditSubreddit()}
                          placeholder="keywords (optional, comma-separated)"
                          style={{ flex: 1, fontSize: 12, padding: "3px 8px", background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--ink-100)" }}
                        />
                        <button className="btn btn-ghost btn-sm" onClick={addRedditSubreddit}>Add</button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Manual — tracked users on other platforms */}
                {s.key === "manual" && (
                  <div className="scard-env">
                    <div className="scard-env-label">Tracked users</div>
                    {userHandles.filter((h) => h.platform !== "hackernews" && h.platform !== "reddit" && h.platform !== "twitter").length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                        {userHandles
                          .filter((h) => h.platform !== "hackernews" && h.platform !== "reddit" && h.platform !== "twitter")
                          .map((h) => (
                            <div key={h.id} style={{ display: "flex", alignItems: "center", gap: 3, background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 4, padding: "2px 6px", fontSize: 12 }}>
                              <span style={{ color: "var(--ink-40)", fontSize: 11 }}>{h.platform}</span>
                              <span style={{ color: "var(--ink-40)", fontSize: 11 }}>·</span>
                              <span className="mono">{h.username}</span>
                              <button
                                onClick={() => handleDeleteUserHandle(h.id)}
                                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-40)", fontSize: 13, padding: 0, lineHeight: 1 }}
                                aria-label={`Remove ${h.username}`}
                              >×</button>
                            </div>
                          ))}
                      </div>
                    )}
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <div style={{ display: "flex", gap: 6 }}>
                        <input
                          type="text"
                          value={manualUserPlatform}
                          onChange={(e) => { setManualUserPlatform(e.target.value); setManualUserError(""); }}
                          placeholder="platform (e.g. linkedin)"
                          style={{ width: 140, fontSize: 12, padding: "3px 8px", background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--ink-100)" }}
                        />
                        <input
                          type="text"
                          value={manualUserUsername}
                          onChange={(e) => { setManualUserUsername(e.target.value); setManualUserError(""); }}
                          onKeyDown={(e) => e.key === "Enter" && handleAddUserHandle(manualUserPlatform, manualUserUsername, () => { setManualUserUsername(""); setManualUserPlatform(""); }, setManualUserError)}
                          placeholder="username"
                          style={{ flex: 1, fontSize: 12, padding: "3px 8px", background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--ink-100)", fontFamily: "var(--font-mono)" }}
                        />
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => handleAddUserHandle(manualUserPlatform, manualUserUsername, () => { setManualUserUsername(""); setManualUserPlatform(""); }, setManualUserError)}
                        >Add</button>
                      </div>
                    </div>
                    {manualUserError && <div style={{ color: "var(--err)", fontSize: 11, marginTop: 4 }}>{manualUserError}</div>}
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

        {/* ── Chrome Extension ── */}
        <div className="tbl-wrap" style={{ marginBottom: 32 }}>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Chrome Extension</div>
            <div style={{ fontSize: 12, color: "var(--ink-60)" }}>Use this key in the Gito Chrome Extension settings to enable direct ingest from your browser.</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type={apiKeyVisible ? "text" : "password"}
              readOnly
              value={apiKey ?? "Loading…"}
              style={{
                flex: 1,
                fontSize: 12,
                padding: "5px 10px",
                background: "var(--surface-1)",
                border: "1px solid var(--border)",
                borderRadius: 4,
                color: "var(--ink-100)",
                fontFamily: "var(--font-mono)",
              }}
            />
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setApiKeyVisible((v) => !v)}
            >
              {apiKeyVisible ? "Hide" : "Show"}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={handleCopyApiKey}
              disabled={!apiKey}
            >
              {apiKeyCopied ? "Copied!" : "Copy key"}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={handleRegenerateApiKey}
              disabled={apiKeyRegenerating}
              style={{ color: "var(--ink-60)" }}
            >
              {apiKeyRegenerating ? "Regenerating…" : "Regenerate"}
            </button>
          </div>
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
          entities={entities.map((e) => ({ id: e.id, label: e.label }))}
          onClose={() => setThreadDialogOpen(false)}
          onInserted={() => setThreadDialogOpen(false)}
        />
      )}
    </>
  );
}
