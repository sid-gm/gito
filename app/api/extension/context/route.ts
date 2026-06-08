import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { companies, trackedEntities } from "@/lib/db/schema";
import { verifyExtensionKey } from "@/lib/extension-auth";
import { eq } from "drizzle-orm";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET(req: Request) {
  const companyId = await verifyExtensionKey(req);
  if (!companyId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: CORS });
  }

  const [company] = await db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(eq(companies.id, companyId));

  if (!company) {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: CORS });
  }

  const entities = await db
    .select({ id: trackedEntities.id, label: trackedEntities.label })
    .from(trackedEntities)
    .where(eq(trackedEntities.companyId, companyId))
    .orderBy(trackedEntities.label);

  return NextResponse.json(
    { companyId: company.id, companyName: company.name, entities },
    { headers: CORS }
  );
}
