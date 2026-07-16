import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { AnalystNav } from "@/components/analyst/AnalystNav";
import { AnalystHeader } from "@/components/analyst/AnalystHeader";
import "./analyst.css";

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--an-font-sans",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--an-font-mono",
});

export default function AnalystLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={`an-shell ${plexSans.variable} ${plexMono.variable}`}>
      <AnalystNav />
      <main className="an-main">
        <AnalystHeader />
        <div className="an-content">{children}</div>
      </main>
    </div>
  );
}
