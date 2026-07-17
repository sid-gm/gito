"use client";

import { useEffect, useState } from "react";
import { useAnalyst } from "@/components/analyst/AnalystContext";
import {
  sentColor,
  fmtScore,
  fmtDay,
  platformMeta,
  topicColor,
} from "@/components/analyst/data";

type GroupMode = "time" | "platform" | "topic";

interface ApiGroup {
  bucket: string;
  topicId?: string | null;
  count: number;
  avgSentiment: string | null;
}

type GroupRow = { label: string; count: number; color: string; sent: number | null };

const MODES: { key: GroupMode; label: string }[] = [
  { key: "time", label: "By time" },
  { key: "platform", label: "By platform" },
  { key: "topic", label: "By topic" },
];

export default function GroupsPage() {
  const { companyId, days } = useAnalyst();
  const [mode, setMode] = useState<GroupMode>("platform");
  const [rows, setRows] = useState<GroupRow[]>([]);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  const queryKey = `${companyId}|${mode}|${days}`;
  const loading = companyId != null && loadedKey !== queryKey;

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    const key = `${companyId}|${mode}|${days}`;
    fetch(`/api/analyst/groups?companyId=${companyId}&by=${mode}&days=${days}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: { groups: ApiGroup[] }) => {
        if (cancelled) return;
        setRows(
          (data.groups ?? []).map((g) => {
            const sent = g.avgSentiment != null ? Number(g.avgSentiment) : null;
            if (mode === "time") {
              return { label: fmtDay(g.bucket), count: g.count, color: "#4f7cff", sent };
            }
            if (mode === "platform") {
              const pm = platformMeta(g.bucket);
              return { label: pm.label, count: g.count, color: pm.color, sent };
            }
            return {
              label: g.bucket,
              count: g.count,
              color: topicColor(g.topicId ?? g.bucket),
              sent,
            };
          })
        );
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadedKey(key);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, days, mode]);

  const max = Math.max(1, ...rows.map((g) => g.count));

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
        {rows.map(({ label, count, color, sent }) => (
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
              {sent != null ? (
                <>
                  <span
                    className="an-sent-dot"
                    style={{ background: sentColor(sent) }}
                  />
                  <span className="an-group-score">{fmtScore(sent)}</span>
                </>
              ) : (
                <span className="an-group-score" style={{ color: "#5f6a80" }}>—</span>
              )}
            </div>
          </div>
        ))}
        {!loading && rows.length === 0 && (
          <div className="an-empty">No items in this window yet.</div>
        )}
      </div>
    </div>
  );
}
