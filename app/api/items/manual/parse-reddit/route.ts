import { NextResponse } from "next/server";
import { z } from "zod";

const schema = z.object({ text: z.string().min(1) });

const BOILERPLATE = new Set([
  "upvote", "downvote", "reply", "award", "share", "upvotevote",
  "more replies", "collapse", "load more comments",
]);

function isBoilerplate(line: string): boolean {
  const l = line.toLowerCase().trim();
  return BOILERPLATE.has(l) || /^\d+$/.test(l);
}

function isTimestamp(line: string): boolean {
  return /^\d+[hmd]\s+ago$/.test(line.trim()) || /^\d+\s+(hour|minute|day|hr|min)s?\s+ago$/i.test(line.trim());
}

export type ParsedComment = {
  author: string;
  body: string;
  score: number | null;
  timestamp: string | null;
};

function parseRedditPaste(text: string): ParsedComment[] {
  const rawLines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const comments: ParsedComment[] = [];

  let i = 0;
  while (i < rawLines.length) {
    const line = rawLines[i];

    // Skip separator or boilerplate lines
    if (isBoilerplate(line) || line === "•" || line === "OP") {
      i++;
      continue;
    }

    // Detect start of a comment: a username line followed by "•" and then timestamp
    if (
      i + 2 < rawLines.length &&
      rawLines[i + 1] === "•" &&
      isTimestamp(rawLines[i + 2])
    ) {
      const author = line.replace(/^u\//, "");
      const timestamp = rawLines[i + 2];
      i += 3;

      // Skip optional flair / location / "Edited X ago" lines
      while (
        i < rawLines.length &&
        !isBoilerplate(rawLines[i]) &&
        rawLines[i] !== "•" &&
        !isTimestamp(rawLines[i]) &&
        rawLines[i].length < 60 &&
        !rawLines[i].includes(" ") // single-word flair
      ) {
        // This is likely a flair — skip it unless it looks like comment text
        const isFlair = rawLines[i].length < 40 && !/[.?!,]/.test(rawLines[i]);
        if (isFlair) { i++; } else { break; }
      }

      // Collect body lines until we hit boilerplate
      const bodyLines: string[] = [];
      while (i < rawLines.length) {
        const cur = rawLines[i];
        if (cur === "•") { i++; break; }
        if (isBoilerplate(cur)) { i++; break; }
        // New comment starts: next line is "•" and line after is timestamp
        if (
          i + 2 < rawLines.length &&
          rawLines[i + 1] === "•" &&
          isTimestamp(rawLines[i + 2]) &&
          !cur.includes(" ")
        ) {
          break;
        }
        bodyLines.push(cur);
        i++;
      }

      // Skip any trailing boilerplate (Upvote, score, Downvote, etc.)
      while (i < rawLines.length && isBoilerplate(rawLines[i])) {
        i++;
      }

      // Extract score — look for a number in the first few boilerplate lines after body
      let score: number | null = null;
      for (const bl of bodyLines) {
        if (/^\d+$/.test(bl)) { score = parseInt(bl, 10); break; }
      }

      const cleanBody = bodyLines.filter((l) => !/^\d+$/.test(l) && !isBoilerplate(l)).join("\n").trim();
      if (cleanBody.length > 0) {
        comments.push({ author, body: cleanBody, score, timestamp });
      }
      continue;
    }

    i++;
  }

  return comments;
}

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const comments = parseRedditPaste(parsed.data.text);
  return NextResponse.json({ comments });
}
