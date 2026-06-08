import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("companyId");
  if (!companyId) {
    return NextResponse.json({ error: "companyId required" }, { status: 400 });
  }

  const [company] = await db
    .select({ apiKey: companies.apiKey })
    .from(companies)
    .where(eq(companies.id, companyId));

  if (!company) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }

  if (!company.apiKey) {
    const newKey = `gito_${crypto.randomUUID().replace(/-/g, "")}`;
    await db.update(companies).set({ apiKey: newKey }).where(eq(companies.id, companyId));
    return NextResponse.json({ apiKey: newKey });
  }

  return NextResponse.json({ apiKey: company.apiKey });
}
