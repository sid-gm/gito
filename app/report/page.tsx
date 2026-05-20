export default function ReportIndex() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60vh", gap: 12, color: "var(--ink-50)" }}>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 32, color: "var(--ink-20)" }}>◈</div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em" }}>No report selected</div>
      <div style={{ fontSize: 13, color: "var(--ink-40)", maxWidth: 320, textAlign: "center", lineHeight: 1.6 }}>
        Open a cluster from the Cluster Review or Narratives tab and click <strong style={{ fontWeight: 600, color: "var(--ink-60)" }}>Generate Report</strong> to create a Signal Brief.
      </div>
    </div>
  );
}
