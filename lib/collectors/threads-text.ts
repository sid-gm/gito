/* ==========================================================================
   Threads post-text normalizer.

   The Threads DOM scraper reads a post container's whole textContent, so the
   raw body arrives wrapped in UI chrome:

     Follow{handle}{flags}{timestamp}More {THE ACTUAL POST TEXT} Like{n}Reply{n}Repost{n}Share{n}

   e.g. "Followilikemycoffeebrownasme4hMoreIf Kai Cenat was Black American …Like111Reply161Repost5Share1"

   The handle is captured separately (items.author), so we can strip the
   leading "Follow…More" header and the trailing action bar precisely. This
   runs on the ingest path (every Threads item) and mirrors the client-side
   clean in the extension collector.
   ========================================================================== */

// digit run with thousands separators and a K/M/B magnitude suffix: 111, 2.3K, 1,234
const COUNT = "[\\d.,]*[KMB]?";

// Trailing action bar, always in this order, counts optional (LikeReplyRepostShare
// when a post has zero interactions).
const ACTION_BAR = new RegExp(
  `(?:See translation|Translate)?\\s*Like${COUNT}\\s*Reply${COUNT}\\s*Repost${COUNT}\\s*Share${COUNT}\\s*$`,
  "i",
);

// Status/media chrome that can sit between the text and the action bar.
const TRAILING_CHROME =
  /\s*(?:Audio is muted|GIF|Translate|See translation|Pinned|Edited|Activity)\s*$/i;

// Relative age (4h, 3m, 2d, 1w, 5y) or an absolute date (Jul 12, June 5 2024).
const TIMESTAMP = "(?:\\d+\\s?[smhdwy]|[A-Z][a-z]{2,8}\\s?\\d{1,2}(?:,?\\s?\\d{4})?)";

// Headers are short; never treat a far-away "More" as the header terminator.
const MAX_HEADER_LEN = 260;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Strip the leading "Follow…More" header and trailing action bar from a raw
 * Threads body. `author` (the captured handle) anchors the header cut when
 * available, which is the safest form. Returns the cleaned text, or the input
 * unchanged when no chrome is recognised.
 */
export function cleanThreadsBody(
  raw: string | null | undefined,
  author?: string | null,
): string | null {
  if (raw == null) return null;
  let s = raw.replace(/ /g, " ").trim();
  if (!s) return s;

  // 1. Trailing action bar + status/media chrome. Loop: these tokens stack
  //    (e.g. "…TranslateAudio is muted"), and stripping one exposes the next.
  let prev: string;
  do {
    prev = s;
    s = s.replace(ACTION_BAR, "").trim();
    s = s.replace(TRAILING_CHROME, "").trim();
  } while (s !== prev);

  // 2. Leading header. The header runs from the start (optionally "Follow",
  //    then the handle, flags, and a timestamp) up to the first "More" — the
  //    post's options button, which always precedes the body.
  const handle = author?.trim() ? escapeRegExp(author.trim()) : null;
  const headerPatterns = [
    // Preferred: anchored on the known handle (Follow optional).
    handle
      ? new RegExp(`^(?:Follow)?${handle}[\\s\\S]*?${TIMESTAMP}[\\s\\S]*?More`)
      : null,
    // Fallback: any "Follow…timestamp…More" run when the handle is unknown.
    new RegExp(`^Follow[\\s\\S]*?${TIMESTAMP}[\\s\\S]*?More`),
  ].filter((p): p is RegExp => p != null);

  for (const pat of headerPatterns) {
    const m = s.match(pat);
    if (m && m[0].length <= MAX_HEADER_LEN) {
      s = s.slice(m[0].length).trim();
      break;
    }
  }

  // 3. Reposts/quotes render the source header without a Follow button or a
  //    "More" terminator: "{handle}{Verified?}{timestamp}{TEXT…}". Strip it
  //    only when the body still opens with a handle-like token + timestamp
  //    immediately followed by sentence-start punctuation/capital — normal
  //    prose does not begin that way, so this stays conservative.
  const repost = s.match(
    new RegExp(
      `^[a-z0-9._]{2,30}(?:Verified|Paid partnership)?${TIMESTAMP}(?:·Author)?(?=[A-Z0-9"'“#@])`,
    ),
  );
  if (repost && repost[0].length <= MAX_HEADER_LEN) {
    s = s.slice(repost[0].length).trim();
  }

  return s;
}
