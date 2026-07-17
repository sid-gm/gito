import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { collectKeywords, topics } from "@/lib/db/schema";
import { verifyExtensionKey } from "@/lib/extension-auth";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";

// CORS + Bearer support: the popup's quick-add posts here with the API key
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

async function resolveCompanyId(req: Request, bodyCompanyId?: string): Promise<string | null> {
  if (req.headers.get("authorization")?.startsWith("Bearer ")) {
    return verifyExtensionKey(req);
  }
  return bodyCompanyId ?? null;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const companyId = await resolveCompanyId(req, searchParams.get("companyId") ?? undefined);
  if (!companyId) {
    return NextResponse.json({ error: "companyId required" }, { status: 400, headers: CORS });
  }

  const rows = await db
    .select({
      id: collectKeywords.id,
      term: collectKeywords.term,
      platforms: collectKeywords.platforms,
      topicId: collectKeywords.topicId,
      topicLabel: topics.label,
      isActive: collectKeywords.isActive,
      createdAt: collectKeywords.createdAt,
    })
    .from(collectKeywords)
    .leftJoin(topics, eq(topics.id, collectKeywords.topicId))
    .where(eq(collectKeywords.companyId, companyId))
    .orderBy(asc(collectKeywords.createdAt));

  return NextResponse.json(rows, { headers: CORS });
}

const createSchema = z.object({
  companyId: z.string().uuid().optional(), // ignored when Bearer auth is used
  topicId: z.string().uuid().nullish(),
  term: z.string().min(2).max(100).transform((v) => v.trim()),
  platforms: z.array(z.enum(["twitter", "threads", "reddit"])).min(1).optional(),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400, headers: CORS }
    );
  }

  const companyId = await resolveCompanyId(req, parsed.data.companyId);
  if (!companyId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: CORS });
  }

  try {
    const [row] = await db
      .insert(collectKeywords)
      .values({
        companyId,
        topicId: parsed.data.topicId ?? null, // quick-adds land unassigned, re-assignable on the site
        term: parsed.data.term,
        ...(parsed.data.platforms ? { platforms: [...new Set(parsed.data.platforms)] } : {}),
      })
      .returning();
    return NextResponse.json(row, { status: 201, headers: CORS });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json({ error: "Keyword already exists" }, { status: 409, headers: CORS });
    }
    return NextResponse.json({ error: "Failed to add keyword" }, { status: 500, headers: CORS });
  }
}
