import {
  type PlatformKey,
  platformMeta,
} from "@/components/analyst/data";

// Mock ingestion status — becomes extension collect runs + RSS feed health after the DB redesign.
const EXTENSION_PLATFORMS: [key: PlatformKey, today: number, active: boolean][] = [
  ["reddit", 342, true],
  ["x", 288, true],
  ["tiktok", 214, true],
  ["threads", 96, true],
  ["instagram", 0, false],
];

const FEEDS: [name: string, items: number, meta: string, active: boolean][] = [
  ['Google News · "Kai Cenat"', 84, "every 15m · 6m ago", true],
  ['Google News · "Streamer University"', 61, "every 15m · 4m ago", true],
  ["Dexerto — Streaming", 22, "every 30m · 12m ago", true],
  ["Dot Esports — Twitch", 18, "every 30m · 20m ago", true],
  ["IGN — Streaming", 0, "every 1h · 3h ago", false],
];

function Status({ active }: { active: boolean }) {
  return (
    <span className={`an-status ${active ? "an-status-active" : "an-status-paused"}`}>
      {active ? "Active" : "Paused"}
    </span>
  );
}

export default function SourcesPage() {
  return (
    <div className="an-sources">
      <section className="an-source-card">
        <div className="an-source-head">
          <div className="an-source-icon">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
            >
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <line x1="3" y1="9" x2="21" y2="9" />
            </svg>
          </div>
          <div className="an-source-titles">
            <div className="an-source-title">Browser extension</div>
            <div className="an-source-sub">v2.4.1 · Chrome</div>
          </div>
          <span className="an-source-status">
            <span className="an-live-dot" />
            Connected
          </span>
        </div>
        {EXTENSION_PLATFORMS.map(([key, today, active]) => {
          const pm = platformMeta(key);
          return (
            <div key={key} className="an-source-row">
              <div className="an-source-row-id">
                <span
                  className="an-tag"
                  style={{ background: pm.color + "22", color: pm.color }}
                >
                  {pm.tag}
                </span>
                <span className="an-source-row-label">{pm.label}</span>
              </div>
              <span className="an-source-row-stat">
                {today.toLocaleString()}
                <span> today</span>
              </span>
              <Status active={active} />
            </div>
          );
        })}
      </section>

      <section className="an-source-card">
        <div className="an-source-head">
          <div className="an-source-icon">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
            >
              <circle cx="6.5" cy="17.5" r="2.5" />
              <path d="M5 11a8 8 0 0 1 8 8" />
              <path d="M5 5a14 14 0 0 1 14 14" />
            </svg>
          </div>
          <div className="an-source-titles">
            <div className="an-source-title">RSS feeds</div>
            <div className="an-source-sub">Google News + publishers</div>
          </div>
          <span className="an-source-count">{FEEDS.length} feeds</span>
        </div>
        {FEEDS.map(([name, items, meta, active]) => (
          <div key={name} className="an-source-row">
            <div style={{ minWidth: 0 }}>
              <div className="an-feed-name">{name}</div>
              <div className="an-feed-meta">{meta}</div>
            </div>
            <span className="an-source-row-stat">{items}</span>
            <Status active={active} />
          </div>
        ))}
      </section>
    </div>
  );
}
