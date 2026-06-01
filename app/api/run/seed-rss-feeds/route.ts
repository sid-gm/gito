import { NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { rssFeeds, trackedEntities } from "@/lib/db/schema";

const FEEDS = [
  { entityId: "81a608b8-0488-4438-b89d-26d4551201b0", feedUrl: "https://www.google.com/alerts/feeds/14281942783603951662/15590046482312571900" },
  { entityId: "2dfc2393-f124-4e9f-af75-db10e1bb9adc", feedUrl: "https://www.google.com/alerts/feeds/14281942783603951662/10055153522577975929" },
  { entityId: "b1ab4fed-4bfa-4c1e-95fb-e76eaacd6091", feedUrl: "https://www.google.com/alerts/feeds/14281942783603951662/13992239778268341604" },
  { entityId: "829eac66-8a2d-40e5-a330-c3d8c6ccdbab", feedUrl: "https://www.google.com/alerts/feeds/14281942783603951662/16961666435133338949" },
  { entityId: "f0886fb6-816b-4b9e-add8-a21388898a54", feedUrl: "https://www.google.com/alerts/feeds/14281942783603951662/4149481944396862973" },
  { entityId: "d66d6546-5809-435d-80ce-61e195c4e86f", feedUrl: "https://www.google.com/alerts/feeds/14281942783603951662/12929125963638987690" },
  { entityId: "8afb91fb-1d3e-4490-a0c9-ca433a27a89a", feedUrl: "https://www.google.com/alerts/feeds/14281942783603951662/9619758275909157284" },
];

export async function POST() {
  const entityIds = FEEDS.map((f) => f.entityId);
  const entities = await db
    .select({ id: trackedEntities.id, label: trackedEntities.label })
    .from(trackedEntities)
    .where(inArray(trackedEntities.id, entityIds));

  const labelById = Object.fromEntries(entities.map((e) => [e.id, e.label]));

  const values = FEEDS.map((f) => ({
    entityId: f.entityId,
    label: labelById[f.entityId] ?? f.entityId,
    feedUrl: f.feedUrl,
  }));

  const inserted = await db
    .insert(rssFeeds)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: rssFeeds.id, label: rssFeeds.label });

  return NextResponse.json({ ok: true, inserted: inserted.length, feeds: inserted });
}
