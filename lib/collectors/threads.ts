import type { NewIngestedItem, TrackedEntity, ThreadsFilter } from "@/lib/db/schema";

interface ThreadsPost {
  id: string;
  text?: string;
  timestamp: string;
  permalink_url?: string;
  username?: string;
}

interface ThreadsResponse {
  data?: ThreadsPost[];
  error?: { message: string; code: number };
}

async function fetchThreads(query: string): Promise<ThreadsPost[]> {
  const token = process.env.THREADS_ACCESS_TOKEN;
  if (!token) throw new Error("THREADS_ACCESS_TOKEN not set");

  const params = new URLSearchParams({
    q: query,
    fields: "id,text,timestamp,permalink_url,username",
    limit: "25",
    access_token: token,
  });

  const res = await fetch(`https://graph.threads.net/v1.0/threads?${params}`);
  if (!res.ok) throw new Error(`Threads API error: ${res.status}`);

  const data = (await res.json()) as ThreadsResponse;
  if (data.error) throw new Error(`Threads API: ${data.error.message}`);
  return data.data ?? [];
}

function matchPosts(
  posts: ThreadsPost[],
  entities: TrackedEntity[],
  filter: ThreadsFilter
): NewIngestedItem[] {
  const items: NewIngestedItem[] = [];
  const seen = new Set<string>();

  for (const post of posts) {
    if (seen.has(post.id)) continue;
    seen.add(post.id);

    const bodyLower = (post.text ?? "").toLowerCase();
    const matchingEntity = entities.find((e) =>
      bodyLower.includes(e.label.toLowerCase())
    );

    items.push({
      entityId: matchingEntity?.id ?? null,
      platform: "threads" as const,
      externalId: post.id,
      url: post.permalink_url ?? `https://www.threads.net/t/${post.id}`,
      title: null,
      body: post.text ?? null,
      author: post.username ? `@${post.username}` : null,
      publishedAt: new Date(post.timestamp),
      subtype: filter.filterType === "user" ? `user:${filter.value}` : `keyword:${filter.value}`,
      rawJson: post,
    });
  }

  return items;
}

export async function collectThreads(
  filters: ThreadsFilter[],
  entities: TrackedEntity[]
): Promise<NewIngestedItem[]> {
  const allItems: NewIngestedItem[] = [];
  const seenIds = new Set<string>();

  for (const filter of filters) {
    const query = filter.filterType === "user"
      ? `from:${filter.value}`
      : filter.value;

    try {
      const posts = await fetchThreads(query);
      const items = matchPosts(posts, entities, filter);
      for (const item of items) {
        if (!seenIds.has(item.externalId!)) {
          seenIds.add(item.externalId!);
          allItems.push(item);
        }
      }
    } catch (err) {
      console.error(`[Threads] filter ${filter.filterType}:${filter.value}:`, err);
    }
  }

  return allItems;
}
