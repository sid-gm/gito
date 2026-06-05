"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useCompany } from "@/components/CompanyContext";

type ReportListItem = {
  id: string;
  clusterId: string;
  clusterLabel: string | null;
  companyName: string | null;
  generatedAt: string;
};

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function ReportsListPage() {
  const { activeCompanyId } = useCompany();
  const router = useRouter();
  const [reports, setReports] = useState<ReportListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete(id: string) {
    setDeleting(true);
    await fetch(`/api/reports/${id}`, { method: "DELETE" });
    setReports((prev) => prev.filter((r) => r.id !== id));
    setConfirmDeleteId(null);
    setDeleting(false);
  }

  useEffect(() => {
    if (!activeCompanyId) return;
    setLoading(true);
    fetch(`/api/reports?companyId=${activeCompanyId}`)
      .then((r) => r.json())
      .then(setReports)
      .finally(() => setLoading(false));
  }, [activeCompanyId]);

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "32px 32px 80px" }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--ink-50)", marginBottom: 6 }}>
          Publish · Reports
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.02em", margin: "0 0 6px", color: "var(--ink)" }}>
          Signal Briefs
        </h1>
        <p style={{ fontSize: 13, color: "var(--ink-60)", margin: 0, lineHeight: 1.5 }}>
          Saved reports generated from Cluster Review or Narratives. Click a report to view the full brief.
        </p>
      </div>

      {loading && (
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--ink-40)", padding: "40px 0", textAlign: "center" }}>
          Loading…
        </div>
      )}

      {!loading && reports.length === 0 && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "60px 0", color: "var(--ink-50)" }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 32, color: "var(--ink-20)" }}>◈</div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em" }}>No reports yet</div>
          <div style={{ fontSize: 13, color: "var(--ink-40)", maxWidth: 320, textAlign: "center", lineHeight: 1.6 }}>
            Open a cluster from <strong style={{ fontWeight: 600, color: "var(--ink-60)" }}>Cluster Review</strong> or <strong style={{ fontWeight: 600, color: "var(--ink-60)" }}>Narratives</strong> and click <strong style={{ fontWeight: 600, color: "var(--ink-60)" }}>◉ Report</strong> to generate your first Signal Brief.
          </div>
        </div>
      )}

      {!loading && reports.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {reports.map((r) => (
            <div
              key={r.id}
              style={{
                display: "flex", alignItems: "center", gap: 0,
                background: "var(--paper)", border: "1px solid var(--border)",
                borderRadius: 8, overflow: "hidden",
              }}
            >
              <button
                onClick={() => router.push(`/analyst/report/${r.id}`)}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
                  padding: "16px 20px", background: "transparent", border: "none",
                  cursor: "pointer", textAlign: "left", flex: 1, minWidth: 0,
                  transition: "background 0.1s",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "var(--paper-2)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)", lineHeight: 1.3, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.clusterLabel ?? <span style={{ fontStyle: "italic", color: "var(--ink-40)" }}>Unnamed cluster</span>}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--ink-50)" }}>
                    {r.companyName && <span>{r.companyName}</span>}
                    {r.companyName && <span>·</span>}
                    <span>{shortDate(r.generatedAt)}</span>
                    <span>·</span>
                    <span>{relativeTime(r.generatedAt)}</span>
                  </div>
                </div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-40)", flexShrink: 0 }}>
                  View →
                </div>
              </button>

              {confirmDeleteId === r.id ? (
                <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 14px", borderLeft: "1px solid var(--border)", flexShrink: 0 }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--ink-60)", whiteSpace: "nowrap" }}>Delete?</span>
                  <button
                    onClick={() => handleDelete(r.id)}
                    disabled={deleting}
                    style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#dc2626", background: "none", border: "none", cursor: "pointer", padding: "4px 2px" }}
                  >
                    Yes
                  </button>
                  <button
                    onClick={() => setConfirmDeleteId(null)}
                    style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--ink-40)", background: "none", border: "none", cursor: "pointer", padding: "4px 2px" }}
                  >
                    No
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDeleteId(r.id)}
                  title="Delete report"
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    padding: "0 14px", height: "100%", background: "none", border: "none",
                    borderLeft: "1px solid var(--border)", cursor: "pointer", color: "var(--ink-30)",
                    transition: "color 0.1s",
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#dc2626"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--ink-30)"; }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6M14 11v6" />
                    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
