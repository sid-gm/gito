# GX-1: Extension Ingest API

**Type:** Backend  
**Depends on:** Nothing — build this first  
**Files touched:**
- `app/api/items/extension-ingest/route.ts` (new)
- `lib/extension-auth.ts` (new)
- `app/api/companies/api-key/route.ts` (new)
- `lib/db/schema.ts` (add `apiKey` column to `companies`)

---

## Context

The Chrome extension (GX-2) needs a single endpoint to POST pre-parsed items to Gito. The extension runs in the user's browser so it already has the rendered content — it sends structured JSON, no scraping happens on the server side.

Auth cannot rely on session cookies (extensions don't share browser session with Next.js auth). Instead, each company gets a static API key stored in the DB, which the analyst copies into the extension settings once.

---

## Schema change — `companies` table

Add an `api_key` column:

```sql
ALTER TABLE "companies" ADD COLUMN "api_key" text UNIQUE;
```

Generate a random key on first access (lazy-init, not at company creation). Use `crypto.randomUUID()` — no external dependency needed.

Drizzle:
```ts
apiKey: text("api_key").unique(),
```

---

## `lib/extension-auth.ts`

```ts
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
```

Returns `companyId` if valid, `null` if not.

---

## `POST /api/items/extension-ingest`

**Auth:** Bearer `{api_key}` in `Authorization` header.

**Request body:**

```ts
type ExtensionItem = {
  url: string;
  title: string;          // tweet text / post title / comment body first 120 chars
  body?: string;          // full text (if longer than title)
  author?: string;        // handle or username
  publishedAt?: string;   // ISO or platform-relative string ("2h ago" is fine — store as-is, parse best-effort)
  platform: "twitter" | "reddit" | "instagram" | "threads" | "manual";
  subtype?: string;       // "x_post", "reddit_post", "instagram_comment", etc.
  externalId?: string;    // tweet ID, post ID, etc. — used for dedup
};

type RequestBody = {
  items: ExtensionItem[];   // 1–100 items per call
  entityId?: string;        // explicit entity association; if omitted, keyword-match against company entities
};
```

**Response:** `{ inserted: number, skipped: number }`

**Logic:**

1. `verifyExtensionKey(req)` → get `companyId` or 401
2. Validate body with Zod (same pattern as `/api/items/manual/bulk`)
3. If `entityId` not provided, keyword-match `title + body` against all `trackedEntities` for this company (same logic as `app/api/items/manual/bulk/route.ts`)
4. `upsertItems(toInsert)` — dedup via `externalId` + `platform` using `onConflictDoNothing`
5. Return `{ inserted, skipped: items.length - inserted }`

**CORS:** Add `Access-Control-Allow-Origin: *` and `Access-Control-Allow-Headers: Authorization, Content-Type` headers — the extension makes cross-origin requests.

```ts
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function POST(req: Request) {
  // ... logic ...
  return NextResponse.json({ inserted, skipped }, { headers: CORS });
}
```

---

## `GET /api/companies/api-key`

Protected by session (same auth as other analyst routes). Returns the current company's API key, generating one if it doesn't exist yet.

```ts
export async function GET() {
  // get companyId from session (same pattern as other routes)
  const [company] = await db.select({ apiKey: companies.apiKey }).from(companies).where(eq(companies.id, companyId));
  
  if (!company.apiKey) {
    const newKey = `gito_${crypto.randomUUID().replace(/-/g, "")}`;
    await db.update(companies).set({ apiKey: newKey }).where(eq(companies.id, companyId));
    return NextResponse.json({ apiKey: newKey });
  }
  return NextResponse.json({ apiKey: company.apiKey });
}
```

---

## Sources page — API key display

In `app/analyst/sources/page.tsx`, add an "Extension" section at the bottom:

- Show the API key from `GET /api/companies/api-key` in a masked text field (show/hide toggle)
- "Copy key" button
- Label: "Use this key in the Gito Chrome Extension settings"
- "Regenerate" button (POST to `/api/companies/api-key/regenerate` — new route, same pattern, just sets a new UUID)

---

## Acceptance Criteria

- [ ] `companies.api_key` column exists with migration
- [ ] `POST /api/items/extension-ingest` returns 401 for missing/invalid key
- [ ] Valid key → items inserted and deduplicated correctly
- [ ] `entityId` keyword-matching works when `entityId` is omitted
- [ ] CORS headers present on both OPTIONS and POST responses
- [ ] API key visible + copyable in Sources page
- [ ] Regenerate invalidates old key immediately
