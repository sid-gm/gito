"use client";

import { useState } from "react";
import { sentColor, fmtScore } from "@/components/analyst/data";

type GroupMode = "time" | "platform" | "topic";

type GroupRow = [label: string, count: number, color: string, sent: number];

// Mock aggregates — becomes a grouped query over ingested items after the DB redesign.
const GROUP_DATA: Record<GroupMode, GroupRow[]> = {
  platform: [
    ["Reddit", 1420, "#ff5722", 0.26],
    ["X", 1180, "#c9ccd1", 0.08],
    ["TikTok", 960, "#22d3ee", 0.43],
    ["Instagram", 540, "#ec4899", 0.52],
    ["Threads", 410, "#a78bfa", 0.4],
    ["News", 302, "#4f7cff", 0.29],
  ],
  topic: [
    ["Streamer University", 1980, "#4f7cff", 0.32],
    ["Kai Cenat", 1240, "#34d399", 0.45],
    ["Subathon", 610, "#f59e0b", -0.08],
    ["AMP", 380, "#a78bfa", 0.3],
    ["Twitch Rivals", 340, "#22d3ee", 0.22],
    ["Collabs", 262, "#ec4899", 0.14],
  ],
  time: [
    ["Jul 10", 420, "#4f7cff", 0.2],
    ["Jul 11", 510, "#4f7cff", 0.3],
    ["Jul 12", 640, "#4f7cff", 0.25],
    ["Jul 13", 900, "#4f7cff", 0.1],
    ["Jul 14", 1180, "#4f7cff", -0.05],
    ["Jul 15", 760, "#4f7cff", 0.22],
    ["Jul 16", 402, "#4f7cff", 0.35],
  ],
};

const MODES: { key: GroupMode; label: string }[] = [
  { key: "time", label: "By time" },
  { key: "platform", label: "By platform" },
  { key: "topic", label: "By topic" },
];

export default function GroupsPage() {
  const [mode, setMode] = useState<GroupMode>("platform");
  const rows = GROUP_DATA[mode];
  const max = Math.max(...rows.map((g) => g[1]));

  return (
    <div>
      <div className="an-seg" style={{ marginBottom: 22 }}>
        {MODES.map((m) => (
          <button
            key={m.key}
            onClick={() => setMode(m.key)}
            className={`an-seg-btn${mode === m.key ? " an-seg-btn-on" : ""}`}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className="an-groups">
        {rows.map(([label, count, color, sent]) => (
          <div key={label} className="an-group-row">
            <div className="an-group-label">
              <span className="an-group-dot" style={{ background: color }} />
              <span className="an-group-name">{label}</span>
            </div>
            <div className="an-group-bar">
              <div
                className="an-group-bar-fill"
                style={{
                  width: `${((count / max) * 100).toFixed(1)}%`,
                  background: `linear-gradient(90deg, ${color}cc, ${color}66)`,
                }}
              />
              <span className="an-group-count">{count.toLocaleString()}</span>
            </div>
            <div className="an-group-sent">
              <span
                className="an-sent-dot"
                style={{ background: sentColor(sent) }}
              />
              <span className="an-group-score">{fmtScore(sent)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
