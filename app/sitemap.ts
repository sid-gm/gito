import type { MetadataRoute } from "next";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";

const SITE_URL = "https://www.usegito.com";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const allCompanies = await db.select({ id: companies.id }).from(companies);

  return [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: "hourly",
      priority: 1,
    },
    ...allCompanies.map((c) => ({
      url: `${SITE_URL}/?company=${c.id}`,
      lastModified: new Date(),
      changeFrequency: "hourly" as const,
      priority: 0.8,
    })),
  ];
}
