import type { Metadata } from "next";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { PublicPortalClient } from "./PortalClient";

const SITE_URL = "https://www.usegito.com";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ company?: string }>;
}): Promise<Metadata> {
  const { company: companyId } = await searchParams;

  let companyName: string | null = null;
  if (companyId) {
    const [row] = await db
      .select({ name: companies.name })
      .from(companies)
      .where(eq(companies.id, companyId))
      .limit(1);
    companyName = row?.name ?? null;
  }

  const title = companyName
    ? `Gito — ${companyName} Intelligence Brief`
    : "Gito — Public Intelligence";

  const description = companyName
    ? `Public narrative tracking for ${companyName} · Updated hourly`
    : "Real-time social media signal intelligence. Updated hourly.";

  const canonical = companyId ? `${SITE_URL}/?company=${companyId}` : SITE_URL;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      siteName: "Gito",
      type: "website",
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
}

export default function PublicPortalPage() {
  return <PublicPortalClient />;
}
