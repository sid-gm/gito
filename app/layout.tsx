import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Gito",
  description: "Signal-to-noise intelligence for social media analysts",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <style>{`
          :root {
            --font-sans: ${geist.style.fontFamily}, ui-sans-serif, system-ui, sans-serif;
            --font-mono: ${jetbrainsMono.style.fontFamily}, ui-monospace, "SF Mono", Menlo, monospace;
          }
        `}</style>
      </head>
      <body className={`${geist.variable} ${jetbrainsMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
