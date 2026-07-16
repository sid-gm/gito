"use client";

import { usePathname } from "next/navigation";
import { HEADER_CHIPS } from "@/components/analyst/data";

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

export function AnalystHeader() {
  const path = usePathname();
  const [title, sub] = TITLES[path] ?? TITLES["/analyst"];
  return (
    <header className="an-header">
      <div className="an-header-titles">
        <div className="an-view-title">{title}</div>
        <div className="an-view-sub">{sub}</div>
      </div>
      <div className="an-header-right">
        <div className="an-chips">
          {HEADER_CHIPS.map((c) => (
            <span
              key={c.label}
              className={`an-chip${c.on ? " an-chip-on" : ""}`}
            >
              {c.label}
            </span>
          ))}
        </div>
        <div className="an-range">
          <span className="an-range-dot" />
          Last 7 days
        </div>
      </div>
    </header>
  );
}
