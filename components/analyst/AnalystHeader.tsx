"use client";

import { usePathname } from "next/navigation";
import { useAnalyst } from "@/components/analyst/AnalystContext";

const TITLES: Record<string, [string, string]> = {
  "/analyst": ["Raw data", "Every scraped post and article, newest first"],
  "/analyst/groups": ["Groups", "Volume clustered by dimension"],
  "/analyst/sentiment": ["Sentiment", "News over time vs. social by platform"],
  "/analyst/bubbles": [
    "Topic bubbles",
    "Topic volume and sentiment across dimensions",
  ],
  "/analyst/sources": ["Sources", "Extension and feed ingestion status"],
};

const RANGES = [
  { days: 7, label: "Last 7 days" },
  { days: 14, label: "Last 14 days" },
  { days: 30, label: "Last 30 days" },
  { days: 90, label: "Last 90 days" },
];

export function AnalystHeader() {
  const path = usePathname();
  const [title, sub] = TITLES[path] ?? TITLES["/analyst"];
  const { companies, companyId, setCompanyId, topics, days, setDays } = useAnalyst();

  return (
    <header className="an-header">
      <div className="an-header-titles">
        <div className="an-view-title">{title}</div>
        <div className="an-view-sub">{sub}</div>
      </div>
      <div className="an-header-right">
        <div className="an-chips">
          {topics.map((t) => (
            <span key={t.id} className="an-chip an-chip-on">
              {t.label}
            </span>
          ))}
          {topics.length === 0 && <span className="an-chip">No topics yet</span>}
        </div>
        {companies.length > 1 && (
          <select
            className="an-select"
            value={companyId ?? ""}
            onChange={(e) => setCompanyId(e.target.value)}
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <div className="an-range">
          <span className="an-range-dot" />
          <select
            className="an-select an-select-bare"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            {RANGES.map((r) => (
              <option key={r.days} value={r.days}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </header>
  );
}
