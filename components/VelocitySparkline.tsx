"use client";

import { useEffect, useState } from "react";
import { Sparkline } from "@/components/primitives";

const STAGE_COLORS: Record<string, string> = {
  emerging:   "var(--ok)",
  developing: "var(--accent)",
  revival:    "#8B5CF6",
  peaked:     "var(--warn)",
  declining:  "var(--err)",
  relaxed:    "var(--ink-40)",
};

type RangeConfig = {
  label: string;
  groupBy: "hour" | "day";
  slots: number;  // number of buckets to fill
  param: string;  // query param string, e.g. "hours=24" or "days=7"
  stepMs: number; // ms per bucket
  keyFmt: (t: Date) => string;
};

function pickRange(firstSeenAt: string): RangeConfig {
  const ageDays = (Date.now() - new Date(firstSeenAt).getTime()) / 86400000;

  const hourKey = (t: Date) => {
    const d = new Date(t);
    d.setMinutes(0, 0, 0);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:00`;
  };
  const dayKey = (t: Date) =>
    `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;

  if (ageDays < 1)  return { label: "24H", groupBy: "hour", slots: 24,  param: "hours=24",  stepMs: 3600000,  keyFmt: hourKey };
  if (ageDays < 3)  return { label: "3D",  groupBy: "hour", slots: 72,  param: "hours=72",  stepMs: 3600000,  keyFmt: hourKey };
  if (ageDays < 7)  return { label: "7D",  groupBy: "day",  slots: 7,   param: "days=7",    stepMs: 86400000, keyFmt: dayKey  };
  if (ageDays < 14) return { label: "14D", groupBy: "day",  slots: 14,  param: "days=14",   stepMs: 86400000, keyFmt: dayKey  };
  return               { label: "30D", groupBy: "day",  slots: 30,  param: "days=30",   stepMs: 86400000, keyFmt: dayKey  };
}

function fillSeries(
  sparse: { bucket: string; count: number }[],
  range: RangeConfig
): number[] {
  const map = new Map(sparse.map((r) => [r.bucket, r.count]));
  const now = Date.now();
  return Array.from({ length: range.slots }, (_, i) => {
    const t = new Date(now - (range.slots - 1 - i) * range.stepMs);
    return map.get(range.keyFmt(t)) ?? 0;
  });
}

export function VelocitySparkline({
  clusterId,
  stage,
  firstSeenAt,
}: {
  clusterId: string;
  stage: string | null;
  firstSeenAt: string;
}) {
  const [series, setSeries] = useState<number[] | null>(null);
  const [label, setLabel] = useState("24H");

  useEffect(() => {
    const range = pickRange(firstSeenAt);
    setLabel(range.label);
    fetch(`/api/clusters/${clusterId}/velocity-history?groupBy=${range.groupBy}&${range.param}`)
      .then((r) => r.json())
      .then((d) => setSeries(fillSeries(d.series ?? [], range)))
      .catch(() => setSeries(null));
  }, [clusterId, firstSeenAt]);

  if (series === null) {
    return <div style={{ width: 120, height: 26, opacity: 0 }} />;
  }

  const hasData = series.some((v) => v > 0);
  if (!hasData) return null;

  const color = STAGE_COLORS[stage ?? ""] ?? "var(--ink-40)";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
      <Sparkline values={series} color={color} fill height={26} />
      <span style={{
        fontFamily: "var(--font-mono)",
        fontSize: 9,
        color,
        opacity: 0.6,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
      }}>
        {label}
      </span>
    </div>
  );
}
