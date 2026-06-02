import { NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron-auth";
import { getAllCompanies } from "@/lib/collectors/ingest";
import { collectAndIngestRedditRss } from "@/lib/collectors/reddit-rss-ingest";

export async function GET(req: Request) {
  const authError = verifyCronSecret(req);
  if (authError) return authError;

  const companies = await getAllCompanies();
  let total = 0;
  console.log(`[cron/reddit-rss] polling ${companies.length} companies`);

  for (const company of companies) {
    try {
      const inserted = await collectAndIngestRedditRss(company.id);
      console.log(`[cron/reddit-rss] company=${company.id} inserted=${inserted}`);
      total += inserted;
    } catch (err) {
      console.error(`[cron/reddit-rss] company=${company.id} error:`, err);
    }
  }

  return NextResponse.json({ ok: true, inserted: total });
}
