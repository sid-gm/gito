import { Sidebar } from "@/components/Sidebar";
import { CompanyProvider } from "@/components/CompanyContext";

export default function AnalystLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <CompanyProvider>
      <div className="shell">
        <Sidebar />
        <div className="main">{children}</div>
      </div>
    </CompanyProvider>
  );
}
