import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("companyId");
  if (!companyId) {
    return NextResponse.json({ error: "companyId required" }, { status: 400 });
  }

  const newKey = `gito_${crypto.randomUUID().replace(/-/g, "")}`;
  const result = await db
    .update(companies)
    .set({ apiKey: newKey })
    .where(eq(companies.id, companyId))
    .returning({ id: companies.id });

  if (result.length === 0) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }

  return NextResponse.json({ apiKey: newKey });
}
