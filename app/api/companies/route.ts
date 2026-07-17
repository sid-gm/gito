import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { asc } from "drizzle-orm";
import { z } from "zod";

const createSchema = z.object({ name: z.string().min(1) });

export async function GET() {
  try {
    let rows = await db.select().from(companies).orderBy(asc(companies.createdAt));

    if (rows.length === 0) {
      const [defaultCompany] = await db
        .insert(companies)
        .values({ name: "Your Company" })
        .returning();
      rows = [defaultCompany];
    }

    return NextResponse.json(rows);
  } catch (err) {
    console.error("[GET /api/companies]", err);
    return NextResponse.json({ error: "Failed to load companies" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const [company] = await db
      .insert(companies)
      .values({ name: parsed.data.name })
      .returning();
    return NextResponse.json(company, { status: 201 });
  } catch (err) {
    console.error("[POST /api/companies]", err);
    return NextResponse.json({ error: "Failed to create company" }, { status: 500 });
  }
}
