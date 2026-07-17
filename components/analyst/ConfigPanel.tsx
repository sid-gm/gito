"use client";

/* Config surface (REDESIGN §1.3) — all collector config lives in Postgres and
   is edited here; the extension pulls a fresh snapshot at the start of every
   run, so changes apply on the next run without touching the popup. */

import { useCallback, useEffect, useState } from "react";
import { useAnalyst } from "@/components/analyst/AnalystContext";
import { platformMeta, topicColor, type Topic } from "@/components/analyst/data";

const KEYWORD_PLATFORMS = ["twitter", "threads", "reddit"] as const;
const SOCIAL_PLATFORMS = ["twitter", "threads", "reddit", "instagram", "facebook", "linkedin"] as const;
type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

interface Keyword {
  id: string;
  term: string;
  platforms: string[];
  topicId: string | null;
  isActive: boolean;
}

interface Subreddit {
  id: string;
  subredditName: string;
  sorts: string[];
  keywordFilters: string[];
  isActive: boolean;
}

interface Handle {
  id: string;
  handle: string;
}

interface Profile {
  id: string;
  platform: string;
  username: string;
}

interface Thread {
  id: string;
  platform: string;
  postUrl: string;
  label: string | null;
  isActive: boolean;
}

interface Feed {
  id: string;
  label: string;
  feedUrl: string;
  topicId: string | null;
  isActive: boolean;
}

interface Settings {
  intervalMinutes: number;
  enabled: boolean;
  pausedPlatforms: string[];
  maxThreadDrills: number;
  visionDisabledPlatforms: string[];
}

async function jfetch<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    });
    if (!res.ok) return null;
    if (res.status === 204) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Fetch-on-mount with manual refresh; state updates only inside promise
    callbacks (React Compiler-safe). */
function useFetched<T>(url: string): { data: T | null; refresh: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    let cancelled = false;
    jfetch<T>(url).then((d) => {
      if (!cancelled && d != null) setData(d);
    });
    return () => {
      cancelled = true;
    };
  }, [url, epoch]);
  const refresh = useCallback(() => setEpoch((e) => e + 1), []);
  return { data, refresh };
}

function TogglePill({ on, labels, onClick }: { on: boolean; labels?: [string, string]; onClick: () => void }) {
  const [onLabel, offLabel] = labels ?? ["Active", "Paused"];
  return (
    <button
      type="button"
      className={`an-status an-status-toggle ${on ? "an-status-active" : "an-status-paused"}`}
      onClick={onClick}
    >
      {on ? onLabel : offLabel}
    </button>
  );
}

function CardHead({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="an-source-head">
      <div className="an-source-titles">
        <div className="an-source-title">{title}</div>
        <div className="an-source-sub">{hint}</div>
      </div>
    </div>
  );
}

/* ── Collector settings ─────────────────────────────────────────────── */

function SettingsCard({ companyId }: { companyId: string }) {
  const { data: settings, refresh } = useFetched<Settings>(`/api/collect-settings?companyId=${companyId}`);

  async function patch(update: Partial<Settings>) {
    await jfetch<Settings>("/api/collect-settings", {
      method: "PATCH",
      body: JSON.stringify({ companyId, ...update }),
    });
    refresh();
  }

  if (!settings) return null;

  const togglePlatform = (list: "pausedPlatforms" | "visionDisabledPlatforms", p: string) => {
    const cur = new Set(settings[list]);
    if (cur.has(p)) cur.delete(p);
    else cur.add(p);
    patch({ [list]: [...cur] as SocialPlatform[] } as Partial<Settings>);
  };

  return (
    <section className="an-source-card">
      <CardHead title="Collector settings" hint="Pulled by the extension at the start of every run" />
      <div className="an-cfg-row">
        <span className="an-cfg-label">Auto-collect</span>
        <TogglePill on={settings.enabled} labels={["Enabled", "Disabled"]} onClick={() => patch({ enabled: !settings.enabled })} />
      </div>
      <div className="an-cfg-row">
        <span className="an-cfg-label">Interval</span>
        <select
          className="an-select"
          value={settings.intervalMinutes}
          onChange={(e) => patch({ intervalMinutes: Number(e.target.value) })}
        >
          {[15, 30, 60, 120, 240, 480].map((m) => (
            <option key={m} value={m}>
              every {m >= 60 ? `${m / 60}h` : `${m}m`}
            </option>
          ))}
        </select>
      </div>
      <div className="an-cfg-row">
        <span className="an-cfg-label">Thread drills per session</span>
        <select
          className="an-select"
          value={settings.maxThreadDrills}
          onChange={(e) => patch({ maxThreadDrills: Number(e.target.value) })}
        >
          {[0, 1, 2, 3, 5, 8, 10].map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </div>
      <div className="an-cfg-row">
        <span className="an-cfg-label">Paused platforms</span>
        <div className="an-cfg-chipset">
          {SOCIAL_PLATFORMS.map((p) => {
            const paused = settings.pausedPlatforms.includes(p);
            return (
              <button
                key={p}
                type="button"
                className={`an-chip${paused ? " an-chip-neg" : ""}`}
                onClick={() => togglePlatform("pausedPlatforms", p)}
              >
                {platformMeta(p).label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="an-cfg-row">
        <span className="an-cfg-label">Vision fallback off</span>
        <div className="an-cfg-chipset">
          {SOCIAL_PLATFORMS.map((p) => {
            const off = settings.visionDisabledPlatforms.includes(p);
            return (
              <button
                key={p}
                type="button"
                className={`an-chip${off ? " an-chip-neg" : ""}`}
                onClick={() => togglePlatform("visionDisabledPlatforms", p)}
              >
                {platformMeta(p).label}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ── Topics & keywords ──────────────────────────────────────────────── */

function TopicsCard({ companyId }: { companyId: string }) {
  const topicsRes = useFetched<Topic[]>(`/api/topics?companyId=${companyId}`);
  const keywordsRes = useFetched<Keyword[]>(`/api/collect-keywords?companyId=${companyId}`);
  const topics = topicsRes.data ?? [];
  const keywords = keywordsRes.data ?? [];
  const load = () => {
    topicsRes.refresh();
    keywordsRes.refresh();
  };
  const [newTopic, setNewTopic] = useState("");
  const [newTerm, setNewTerm] = useState("");
  const [newTermTopic, setNewTermTopic] = useState("");
  const [newTermPlatforms, setNewTermPlatforms] = useState<string[]>([...KEYWORD_PLATFORMS]);

  async function addTopic() {
    const label = newTopic.trim();
    if (!label) return;
    await jfetch("/api/topics", { method: "POST", body: JSON.stringify({ companyId, label }) });
    setNewTopic("");
    load();
  }

  async function addKeyword() {
    const term = newTerm.trim();
    if (!term || newTermPlatforms.length === 0) return;
    await jfetch("/api/collect-keywords", {
      method: "POST",
      body: JSON.stringify({
        companyId,
        term,
        topicId: newTermTopic || null,
        platforms: newTermPlatforms,
      }),
    });
    setNewTerm("");
    load();
  }

  const keywordChip = (k: Keyword) => (
    <span key={k.id} className="an-chip an-chip-x" title={`Searches: ${k.platforms.map((p) => platformMeta(p).label).join(", ")}`}>
      {k.term}
      <button
        type="button"
        onClick={async () => {
          await jfetch(`/api/collect-keywords/${k.id}?companyId=${companyId}`, { method: "DELETE" });
          load();
        }}
      >
        ×
      </button>
    </span>
  );

  const unassigned = keywords.filter((k) => !k.topicId);

  return (
    <section className="an-source-card">
      <CardHead title="Topics & keywords" hint="Each keyword's finds are tagged with its topic (provenance)" />
      {topics.map((t) => (
        <div key={t.id} className="an-cfg-block">
          <div className="an-cfg-block-head">
            <span className="an-topic-pill" style={{ background: topicColor(t.id) + "1c", color: topicColor(t.id) }}>
              {t.label}
            </span>
            <button
              type="button"
              className="an-x-btn"
              title="Delete topic (keywords stay, unassigned)"
              onClick={async () => {
                await jfetch(`/api/topics/${t.id}`, { method: "DELETE" });
                load();
              }}
            >
              ×
            </button>
          </div>
          <div className="an-cfg-chipset">
            {keywords.filter((k) => k.topicId === t.id).map(keywordChip)}
            {keywords.filter((k) => k.topicId === t.id).length === 0 && (
              <span className="an-feed-meta">no keywords</span>
            )}
          </div>
        </div>
      ))}
      {unassigned.length > 0 && (
        <div className="an-cfg-block">
          <div className="an-cfg-block-head">
            <span className="an-feed-meta">Unassigned</span>
          </div>
          <div className="an-cfg-list">
            {unassigned.map((k) => (
              <div key={k.id} className="an-cfg-inline">
                {keywordChip(k)}
                <select
                  className="an-select"
                  value=""
                  onChange={async (e) => {
                    if (!e.target.value) return;
                    await jfetch(`/api/collect-keywords/${k.id}`, {
                      method: "PATCH",
                      body: JSON.stringify({ topicId: e.target.value }),
                    });
                    load();
                  }}
                >
                  <option value="">assign topic…</option>
                  {topics.map((t) => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="an-cfg-form">
        <input
          className="an-input"
          placeholder="New keyword…"
          value={newTerm}
          onChange={(e) => setNewTerm(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addKeyword()}
        />
        <select className="an-select" value={newTermTopic} onChange={(e) => setNewTermTopic(e.target.value)}>
          <option value="">no topic</option>
          {topics.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
        <div className="an-cfg-chipset">
          {KEYWORD_PLATFORMS.map((p) => (
            <button
              key={p}
              type="button"
              className={`an-chip${newTermPlatforms.includes(p) ? " an-chip-on" : ""}`}
              onClick={() =>
                setNewTermPlatforms((cur) =>
                  cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]
                )
              }
            >
              {platformMeta(p).label}
            </button>
          ))}
        </div>
        <button type="button" className="an-btn" onClick={addKeyword}>Add keyword</button>
      </div>
      <div className="an-cfg-form">
        <input
          className="an-input"
          placeholder="New topic…"
          value={newTopic}
          onChange={(e) => setNewTopic(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addTopic()}
        />
        <button type="button" className="an-btn" onClick={addTopic}>Add topic</button>
      </div>
    </section>
  );
}

/* ── Subreddits ─────────────────────────────────────────────────────── */

function SubredditsCard({ companyId }: { companyId: string }) {
  const { data, refresh: load } = useFetched<Subreddit[]>(`/api/reddit-subreddits?companyId=${companyId}`);
  const subs = data ?? [];
  const [newSub, setNewSub] = useState("");

  async function patch(id: string, body: Record<string, unknown>) {
    await jfetch(`/api/reddit-subreddits/${id}?companyId=${companyId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    load();
  }

  return (
    <section className="an-source-card">
      <CardHead title="Subreddits" hint="Browsed as listing pages (new/hot); filters match title or body" />
      {subs.map((s) => (
        <div key={s.id} className="an-cfg-row">
          <span className="an-cfg-label" style={{ color: "#ff8a65" }}>r/{s.subredditName}</span>
          <div className="an-cfg-inline">
            {(["new", "hot"] as const).map((sort) => (
              <button
                key={sort}
                type="button"
                className={`an-chip${s.sorts.includes(sort) ? " an-chip-on" : ""}`}
                onClick={() => {
                  const next = s.sorts.includes(sort)
                    ? s.sorts.filter((x) => x !== sort)
                    : [...s.sorts, sort];
                  if (next.length === 0) return; // at least one sort
                  patch(s.id, { sorts: next });
                }}
              >
                {sort}
              </button>
            ))}
            <input
              className="an-input an-input-sm"
              defaultValue={s.keywordFilters.join(", ")}
              placeholder="keyword filters (optional)"
              onBlur={(e) => {
                const filters = e.target.value.split(",").map((x) => x.trim()).filter(Boolean);
                if (filters.join(",") !== s.keywordFilters.join(",")) {
                  patch(s.id, { keywordFilters: filters });
                }
              }}
            />
            <TogglePill on={s.isActive} onClick={() => patch(s.id, { isActive: !s.isActive })} />
            <button
              type="button"
              className="an-x-btn"
              onClick={async () => {
                await jfetch(`/api/reddit-subreddits/${s.id}?companyId=${companyId}`, { method: "DELETE" });
                load();
              }}
            >
              ×
            </button>
          </div>
        </div>
      ))}
      <div className="an-cfg-form">
        <input
          className="an-input"
          placeholder="r/subreddit"
          value={newSub}
          onChange={(e) => setNewSub(e.target.value)}
          onKeyDown={async (e) => {
            if (e.key !== "Enter") return;
            const subredditName = newSub.trim();
            if (!subredditName) return;
            await jfetch("/api/reddit-subreddits", {
              method: "POST",
              body: JSON.stringify({ companyId, subredditName }),
            });
            setNewSub("");
            load();
          }}
        />
        <button
          type="button"
          className="an-btn"
          onClick={async () => {
            const subredditName = newSub.trim();
            if (!subredditName) return;
            await jfetch("/api/reddit-subreddits", {
              method: "POST",
              body: JSON.stringify({ companyId, subredditName }),
            });
            setNewSub("");
            load();
          }}
        >
          Add subreddit
        </button>
      </div>
    </section>
  );
}

/* ── Handles & profiles ─────────────────────────────────────────────── */

function ProfilesCard({ companyId }: { companyId: string }) {
  const handlesRes = useFetched<Handle[]>(`/api/twitter-handles?companyId=${companyId}`);
  const profilesRes = useFetched<Profile[]>(`/api/user-handles?companyId=${companyId}`);
  const handles = handlesRes.data ?? [];
  const profiles = profilesRes.data ?? [];
  const load = () => {
    handlesRes.refresh();
    profilesRes.refresh();
  };
  const [newHandle, setNewHandle] = useState("");
  const [newProfile, setNewProfile] = useState("");
  const [newProfilePlatform, setNewProfilePlatform] = useState("threads");

  async function addHandle() {
    const handle = newHandle.trim();
    if (!handle) return;
    await jfetch("/api/twitter-handles", { method: "POST", body: JSON.stringify({ companyId, handle }) });
    setNewHandle("");
    load();
  }

  async function addProfile() {
    const username = newProfile.trim();
    if (!username) return;
    await jfetch("/api/user-handles", {
      method: "POST",
      body: JSON.stringify({ companyId, platform: newProfilePlatform, username }),
    });
    setNewProfile("");
    load();
  }

  return (
    <section className="an-source-card">
      <CardHead title="Tracked profiles" hint="Timelines collected every run (X handles + other platforms)" />
      <div className="an-cfg-block">
        <div className="an-cfg-chipset">
          {handles.map((h) => (
            <span key={h.id} className="an-chip an-chip-x">
              @{h.handle} · X
              <button
                type="button"
                onClick={async () => {
                  await jfetch(`/api/twitter-handles/${h.id}?companyId=${companyId}`, { method: "DELETE" });
                  load();
                }}
              >
                ×
              </button>
            </span>
          ))}
          {profiles.map((p) => (
            <span key={p.id} className="an-chip an-chip-x">
              @{p.username} · {platformMeta(p.platform).label}
              <button
                type="button"
                onClick={async () => {
                  await jfetch(`/api/user-handles/${p.id}?companyId=${companyId}`, { method: "DELETE" });
                  load();
                }}
              >
                ×
              </button>
            </span>
          ))}
          {handles.length === 0 && profiles.length === 0 && (
            <span className="an-feed-meta">no tracked profiles</span>
          )}
        </div>
      </div>
      <div className="an-cfg-form">
        <input
          className="an-input"
          placeholder="@handle on X"
          value={newHandle}
          onChange={(e) => setNewHandle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addHandle()}
        />
        <button type="button" className="an-btn" onClick={addHandle}>Add X handle</button>
      </div>
      <div className="an-cfg-form">
        <select
          className="an-select"
          value={newProfilePlatform}
          onChange={(e) => setNewProfilePlatform(e.target.value)}
        >
          {SOCIAL_PLATFORMS.filter((p) => p !== "twitter").map((p) => (
            <option key={p} value={p}>{platformMeta(p).label}</option>
          ))}
        </select>
        <input
          className="an-input"
          placeholder="@username"
          value={newProfile}
          onChange={(e) => setNewProfile(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addProfile()}
        />
        <button type="button" className="an-btn" onClick={addProfile}>Add profile</button>
      </div>
    </section>
  );
}

/* ── Tracked threads ────────────────────────────────────────────────── */

function ThreadsCard({ companyId }: { companyId: string }) {
  const { data, refresh: load } = useFetched<Thread[]>(`/api/tracked-threads?companyId=${companyId}`);
  const threads = data ?? [];
  const [newUrl, setNewUrl] = useState("");
  const [newPlatform, setNewPlatform] = useState("twitter");

  async function addThread() {
    const postUrl = newUrl.trim();
    if (!postUrl) return;
    await jfetch("/api/tracked-threads", {
      method: "POST",
      body: JSON.stringify({ companyId, platform: newPlatform, postUrl }),
    });
    setNewUrl("");
    load();
  }

  return (
    <section className="an-source-card">
      <CardHead title="Tracked threads" hint="Specific posts re-collected every run for new replies" />
      {threads.map((t) => {
        const pm = platformMeta(t.platform);
        return (
          <div key={t.id} className="an-source-row">
            <div style={{ minWidth: 0 }}>
              <div className="an-feed-name">
                <span className="an-tag" style={{ background: pm.color + "22", color: pm.color, marginRight: 8 }}>
                  {pm.tag}
                </span>
                {t.label ?? t.postUrl}
              </div>
              <div className="an-feed-meta">{t.postUrl}</div>
            </div>
            <TogglePill
              on={t.isActive}
              onClick={async () => {
                await jfetch(`/api/tracked-threads/${t.id}`, {
                  method: "PATCH",
                  body: JSON.stringify({ isActive: !t.isActive }),
                });
                load();
              }}
            />
            <button
              type="button"
              className="an-x-btn"
              onClick={async () => {
                await jfetch(`/api/tracked-threads/${t.id}`, { method: "DELETE" });
                load();
              }}
            >
              ×
            </button>
          </div>
        );
      })}
      <div className="an-cfg-form">
        <select className="an-select" value={newPlatform} onChange={(e) => setNewPlatform(e.target.value)}>
          {SOCIAL_PLATFORMS.map((p) => (
            <option key={p} value={p}>{platformMeta(p).label}</option>
          ))}
        </select>
        <input
          className="an-input"
          placeholder="Post URL…"
          value={newUrl}
          onChange={(e) => setNewUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addThread()}
        />
        <button type="button" className="an-btn" onClick={addThread}>Track thread</button>
      </div>
    </section>
  );
}

/* ── RSS feeds ──────────────────────────────────────────────────────── */

function FeedsCard({ companyId }: { companyId: string }) {
  const feedsRes = useFetched<Feed[]>(`/api/rss-feeds?companyId=${companyId}`);
  const topicsRes = useFetched<Topic[]>(`/api/topics?companyId=${companyId}`);
  const feeds = feedsRes.data ?? [];
  const topics = topicsRes.data ?? [];
  const load = () => feedsRes.refresh();
  const [newLabel, setNewLabel] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newTopic, setNewTopic] = useState("");

  async function addFeed() {
    const label = newLabel.trim();
    const feedUrl = newUrl.trim();
    if (!label || !feedUrl) return;
    await jfetch("/api/rss-feeds", {
      method: "POST",
      body: JSON.stringify({ companyId, label, feedUrl, topicId: newTopic || null }),
    });
    setNewLabel("");
    setNewUrl("");
    load();
  }

  return (
    <section className="an-source-card">
      <CardHead title="RSS feeds" hint="Google News / publisher feeds, collected daily; items land as News" />
      {feeds.map((f) => (
        <div key={f.id} className="an-source-row">
          <div style={{ minWidth: 0 }}>
            <div className="an-feed-name">{f.label}</div>
            <div className="an-feed-meta">{f.feedUrl}</div>
          </div>
          <select
            className="an-select"
            value={f.topicId ?? ""}
            onChange={async (e) => {
              await jfetch(`/api/rss-feeds/${f.id}`, {
                method: "PATCH",
                body: JSON.stringify({ topicId: e.target.value || null }),
              });
              load();
            }}
          >
            <option value="">no topic</option>
            {topics.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
          <TogglePill
            on={f.isActive}
            onClick={async () => {
              await jfetch(`/api/rss-feeds/${f.id}`, {
                method: "PATCH",
                body: JSON.stringify({ isActive: !f.isActive }),
              });
              load();
            }}
          />
          <button
            type="button"
            className="an-x-btn"
            onClick={async () => {
              await jfetch(`/api/rss-feeds/${f.id}`, { method: "DELETE" });
              load();
            }}
          >
            ×
          </button>
        </div>
      ))}
      <div className="an-cfg-form">
        <input
          className="an-input an-input-sm"
          placeholder="Label"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
        />
        <input
          className="an-input"
          placeholder="Feed URL…"
          value={newUrl}
          onChange={(e) => setNewUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addFeed()}
        />
        <select className="an-select" value={newTopic} onChange={(e) => setNewTopic(e.target.value)}>
          <option value="">no topic</option>
          {topics.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
        <button type="button" className="an-btn" onClick={addFeed}>Add feed</button>
      </div>
    </section>
  );
}

/* ── Panel ──────────────────────────────────────────────────────────── */

export function ConfigPanel() {
  const { companyId } = useAnalyst();
  if (!companyId) return null;
  return (
    <>
      <div className="an-cfg-divider">
        <span className="an-section-title">Configuration</span>
        <span className="an-section-hint">Changes apply on the extension&apos;s next run</span>
      </div>
      <div className="an-sources">
        <TopicsCard companyId={companyId} />
        <SettingsCard companyId={companyId} />
        <SubredditsCard companyId={companyId} />
        <ProfilesCard companyId={companyId} />
        <ThreadsCard companyId={companyId} />
        <FeedsCard companyId={companyId} />
      </div>
    </>
  );
}
