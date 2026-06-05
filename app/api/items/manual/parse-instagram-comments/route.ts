import { NextResponse } from "next/server";
import { z } from "zod";

const schema = z.object({ text: z.string().min(1) });

export type ParsedInstagramComment = {
  author: string;
  body: string;
  timestamp: string | null;
};

// Instagram relative timestamp: 5h, 2m, 3d, 1w, 4s
const TIMESTAMP_RE = /^\d+[smhdw]$/i;
// Avatar label lines like "elllepirata's profile picture"
const PROFILE_PIC_RE = /^.+'s profile picture$/i;

function parseInstagramCommentsPaste(text: string): ParsedInstagramComment[] {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !PROFILE_PIC_RE.test(l));

  const comments: ParsedInstagramComment[] = [];
  let i = 0;

  while (i < lines.length) {
    // A block starts when lines[i] is a username and lines[i+1] is a timestamp
    if (i + 1 < lines.length && TIMESTAMP_RE.test(lines[i + 1]) && !TIMESTAMP_RE.test(lines[i])) {
      const author = lines[i];
      const timestamp = lines[i + 1];
      i += 2;

      // Collect body lines until next username+timestamp block
      const bodyLines: string[] = [];
      while (i < lines.length) {
        if (i + 1 < lines.length && TIMESTAMP_RE.test(lines[i + 1]) && !TIMESTAMP_RE.test(lines[i])) break;
        bodyLines.push(lines[i]);
        i++;
      }

      const body = bodyLines.join("\n").trim();
      if (body) {
        comments.push({ author, body, timestamp });
      }
    } else {
      i++;
    }
  }

  return comments;
}

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const comments = parseInstagramCommentsPaste(parsed.data.text);
  return NextResponse.json({ comments });
}
