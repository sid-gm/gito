import { NextResponse } from "next/server";
import { z } from "zod";

const schema = z.object({ text: z.string().min(1) });

export type ParsedTweet = {
  author: string;
  displayName: string;
  body: string;
  tweetUrl: string | null;
  timestamp: string | null;
  isOriginalPost: boolean;
};

// Markdown link pattern: [text](url)
const MD_LINK = /^\[(.+?)\]\((https?:\/\/.+?)\)$/;
// Plain-text date like "May 28", "Jun 1", "Dec 31, 2024"
const DATE_RE = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}(,\s*\d{4})?$/i;

const SKIP_LINES = new Set(["show replies", "show more", "show less"]);
const ENGAGEMENT_RE = /^\d+ (repost|like|reply|bookmark|quote)s?$/i;

/**
 * A tweet block starts when:
 *  - line[i]   is a display name  (not starting with @, not "·", not a skip line)
 *  - line[i+1] is a @handle
 *  - line[i+2] is "·" or "Ad"
 *
 * Works for both plain-text and markdown-link pastes.
 */
function isBlockStart(lines: string[], i: number): boolean {
  if (i + 2 >= lines.length) return false;
  const l0 = lines[i];
  const l1 = lines[i + 1];
  const l2 = lines[i + 2];

  // l0 must look like a display name
  const l0lower = l0.toLowerCase();
  if (SKIP_LINES.has(l0lower) || ENGAGEMENT_RE.test(l0) || l0 === "·" || l0 === "Ad") return false;

  // l1 must be a @handle (plain text) or a markdown link starting with @
  const l1isHandle = l1.startsWith("@") || MD_LINK.test(l1) && (l1.match(MD_LINK)?.[1] ?? "").startsWith("@");
  if (!l1isHandle) return false;

  // l2 must be "·" or "Ad"
  return l2 === "·" || l2 === "Ad";
}

function parseXThreadPaste(text: string): ParsedTweet[] {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const tweets: ParsedTweet[] = [];
  let i = 0;
  let firstNonAd = true;

  while (i < lines.length) {
    const line = lines[i];
    const lower = line.toLowerCase();

    // Skip standalone noise lines
    if (SKIP_LINES.has(lower) || ENGAGEMENT_RE.test(line) || line === "·" || line === "Ad") {
      i++;
      continue;
    }

    if (!isBlockStart(lines, i)) {
      i++;
      continue;
    }

    // --- Parse the block header ---
    // Display name: could be plain text or a markdown link
    const nameLink = line.match(MD_LINK);
    const displayName = nameLink ? nameLink[1] : line;

    // Handle: plain "@foo" or markdown "[@foo](url)"
    const handleLine = lines[i + 1];
    const handleLink = handleLine.match(MD_LINK);
    const author = handleLink
      ? handleLink[1].replace(/^@/, "")
      : handleLine.replace(/^@/, "");

    const separator = lines[i + 2]; // "·" or "Ad"
    i += 3;

    // Ad block — skip until next block
    if (separator === "Ad") {
      while (i < lines.length && !isBlockStart(lines, i)) i++;
      continue;
    }

    // separator === "·" — next line is the date
    let timestamp: string | null = null;
    let tweetUrl: string | null = null;

    if (i < lines.length) {
      const dateLine = lines[i];
      const dateLink = dateLine.match(MD_LINK);
      if (dateLink) {
        timestamp = dateLink[1];
        tweetUrl = dateLink[2];
        i++;
      } else if (DATE_RE.test(dateLine)) {
        timestamp = dateLine;
        i++;
      }
      // If neither, date is missing — don't advance; body starts here
    }

    // Collect body lines until next block or noise
    const bodyLines: string[] = [];
    while (i < lines.length) {
      const cur = lines[i];
      const curLower = cur.toLowerCase();
      if (SKIP_LINES.has(curLower) || ENGAGEMENT_RE.test(cur)) { i++; continue; }
      if (cur === "Ad") break;
      if (isBlockStart(lines, i)) break;
      bodyLines.push(cur);
      i++;
    }

    const body = bodyLines.join("\n").trim();
    if (!body) continue;

    const isOriginalPost = firstNonAd;
    firstNonAd = false;

    tweets.push({ author, displayName, body, tweetUrl, timestamp, isOriginalPost });
  }

  return tweets;
}

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const tweets = parseXThreadPaste(parsed.data.text);
  return NextResponse.json({ tweets });
}
