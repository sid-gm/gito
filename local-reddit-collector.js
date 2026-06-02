#!/usr/bin/env node
/**
 * local-reddit-collector.js
 *
 * Runs on your local machine. Fetches Reddit RSS feeds every 10 minutes
 * using your residential IP (bypasses Reddit's Vercel-IP block), then
 * upserts items directly into the shared Neon Postgres database.
 *
 * Quick start:
 *   node local-reddit-collector.js
 *
 * Persistent (survives reboots):
 *   npm install -g pm2
 *   pm2 start local-reddit-collector.js --name reddit-collector
 *   pm2 save && pm2 startup
 *
 * Requires: .env.local with sma_DATABASE_URL_UNPOOLED (already present).
 */

const fs = require("fs");
const path = require("path");
const { neon } = require("@neondatabase/serverless");
const Parser = require("rss-parser");

// ── Env loader ────────────────────────────────────────────────────────────────

function loadEnvFile(file) {
  try {
    const raw = fs.readFileSync(file, "utf8");
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq === -1) continue;
      const key = t.slice(0, eq).trim();
      let val = t.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    // file doesn't exist — skip
  }
}

loadEnvFile(path.join(__dirname, ".env.local"));
loadEnvFile(path.join(__dirname, ".env"));

const DB_URL =
  process.env.sma_DATABASE_URL_UNPOOLED ||
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.sma_DATABASE_URL ||
  process.env.DATABASE_URL;

if (!DB_URL) {
  console.error(
    "ERROR: No database URL found.\n" +
      "Add sma_DATABASE_URL_UNPOOLED to .env.local and try again."
  );
  process.exit(1);
}

const sql = neon(DB_URL);
const rssParser = new Parser();

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const INTERVAL_MS = 20 * 60 * 1000;

// ── Helpers (mirrored from lib/collectors/reddit-rss.ts) ─────────────────────

function buildRssUrl(subredditName, keywordFilters) {
  if (subredditName === "all") {
    const q = keywordFilters.join(" OR ");
    return `https://www.reddit.com/search.rss?${new URLSearchParams({ q, sort: "new", type: "link" })}`;
  }
  if (keywordFilters.length === 0) {
    return `https://www.reddit.com/r/${subredditName}/new/.rss`;
  }
  const q = keywordFilters.join(" OR ");
  return `https://www.reddit.com/r/${subredditName}/search.rss?${new URLSearchParams({ q, restrict_sr: "1", sort: "new" })}`;
}

function stripHtml(raw) {
  if (!raw) return "";
  return raw
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function now() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

// ── Collection cycle ──────────────────────────────────────────────────────────

async function runOnce() {
  let companies;
  try {
    companies = await sql`SELECT id, name FROM companies ORDER BY created_at`;
  } catch (err) {
    console.error(`[${now()}] DB error: ${err.message}`);
    return;
  }

  for (const company of companies) {
    const [subreddits, entities] = await Promise.all([
      sql`SELECT subreddit_name, keyword_filters FROM reddit_subreddits WHERE company_id = ${company.id}`,
      sql`SELECT id, label FROM tracked_entities WHERE company_id = ${company.id}`,
    ]);

    if (subreddits.length === 0) continue;

    for (const sub of subreddits) {
      const name = sub.subreddit_name;
      const filters = sub.keyword_filters ?? [];

      let posts;
      try {
        const url = buildRssUrl(name, filters);
        const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const feed = await rssParser.parseString(await res.text());
        posts = feed.items.map((item) => {
          const guid = item.id ?? item.guid ?? "";
          const post_id = guid.replace(/^t\d+_/, "") || guid;
          const rawBody = stripHtml(item.content ?? item.contentSnippet);
          const rawAuthor = item.creator ?? item.author ?? "";
          return {
            post_id,
            title: item.title ?? "",
            permalink: item.link ?? "",
            author: rawAuthor.replace(/^\/u\//, ""),
            published_iso: item.isoDate ?? item.pubDate ?? new Date().toISOString(),
            body: rawBody.length >= 10 ? rawBody : null,
          };
        });
      } catch (err) {
        console.error(`[${now()}] r/${name} (${company.name}): ${err.message}`);
        continue;
      }

      let inserted = 0;
      for (const post of posts) {
        const combined = `${post.title} ${post.body ?? ""}`;
        const match = entities.find((e) =>
          combined.toLowerCase().includes(e.label.toLowerCase())
        );

        try {
          const rows = await sql`
            INSERT INTO ingested_items
              (id, entity_id, platform, external_id, url, title, body,
               author, published_at, raw_json, subtype)
            VALUES (
              gen_random_uuid(),
              ${match?.id ?? null},
              'reddit',
              ${post.post_id},
              ${post.permalink},
              ${post.title},
              ${post.body},
              ${post.author},
              ${post.published_iso}::timestamptz,
              ${JSON.stringify({ subreddit: name, keyword_filters: filters })}::jsonb,
              'reddit_post'
            )
            ON CONFLICT (platform, external_id) DO NOTHING
            RETURNING id
          `;
          if (rows.length > 0) inserted++;
        } catch (err) {
          console.error(`[${now()}] r/${name} insert error (${post.post_id}): ${err.message}`);
        }
      }

      console.log(
        `[${now()}] r/${name} (${company.name}): ${inserted} new / ${posts.length} fetched`
      );
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log(`[${now()}] Reddit collector starting — polling every ${INTERVAL_MS / 60000}min`);
console.log(`[${now()}] DB: ${DB_URL.replace(/:([^@]+)@/, ":***@")}`);

runOnce().catch((e) => console.error(`[${now()}] Run error:`, e.message));
const timer = setInterval(
  () => runOnce().catch((e) => console.error(`[${now()}] Run error:`, e.message)),
  INTERVAL_MS
);

process.on("SIGINT", () => {
  console.log(`\n[${now()}] Shutting down.`);
  clearInterval(timer);
  process.exit(0);
});
