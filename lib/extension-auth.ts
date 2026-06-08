import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function verifyExtensionKey(req: Request): Promise<string | null> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const key = auth.slice(7);
  const [company] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(eq(companies.apiKey, key))
    .limit(1);
  return company?.id ?? null;
}
