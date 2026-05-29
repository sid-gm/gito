import type { NewIngestedItem, TrackedEntity, ThreadsFilter } from "@/lib/db/schema";

interface ThreadsPost {
  id: string;
  text?: string;
  timestamp: string;
  permalink?: string;
  username?: string;
}

interface ThreadsResponse {
  data?: ThreadsPost[];
  error?: { message: string; code: number };
}

async function fetchByKeyword(keyword: string, token: string): Promise<ThreadsPost[]> {
  const params = new URLSearchParams({
    q: keyword,
    fields: "id,text,timestamp,permalink,username",
    access_token: token,
  });

  const res = await fetch(`https://graph.threads.net/v1.0/threads?${params}`);
  const data = (await res.json()) as ThreadsResponse;
  if (!res.ok || data.error) {
    throw new Error(`Threads keyword API error ${res.status}: ${data.error?.message ?? "unknown"}`);
  }
  return data.data ?? [];
}

async function fetchByUser(username: string, token: string): Promise<ThreadsPost[]> {
  // Look up the user's numeric ID by username, then fetch their threads
  const lookupParams = new URLSearchParams({
    fields: "id",
    access_token: token,
  });
  const lookupRes = await fetch(`https://graph.threads.net/v1.0/${username}?${lookupParams}`);
  const lookupData = (await lookupRes.json()) as { id?: string; error?: { message: string } };
  if (!lookupRes.ok || lookupData.error) {
    throw new Error(`Threads user lookup error ${lookupRes.status}: ${lookupData.error?.message ?? "unknown"}`);
  }
  if (!lookupData.id) throw new Error(`Threads: no ID returned for user ${username}`);

  const threadParams = new URLSearchParams({
    fields: "id,text,timestamp,permalink,username",
    access_token: token,
  });
  const threadRes = await fetch(`https://graph.threads.net/v1.0/${lookupData.id}/threads?${threadParams}`);
  const threadData = (await threadRes.json()) as ThreadsResponse;
  if (!threadRes.ok || threadData.error) {
    throw new Error(`Threads user threads error ${threadRes.status}: ${threadData.error?.message ?? "unknown"}`);
  }
  return threadData.data ?? [];
}

function mapPosts(
  posts: ThreadsPost[],
  entities: TrackedEntity[],
  filter: ThreadsFilter
): NewIngestedItem[] {
  return posts.map((post) => {
    const bodyLower = (post.text ?? "").toLowerCase();
    const matchingEntity = entities.find((e) =>
      bodyLower.includes(e.label.toLowerCase())
    );
    return {
      entityId: matchingEntity?.id ?? null,
      platform: "threads" as const,
      externalId: post.id,
      url: post.permalink ?? `https://www.threads.net/t/${post.id}`,
      title: null,
      body: post.text ?? null,
      author: post.username ? `@${post.username}` : null,
      publishedAt: new Date(post.timestamp),
      subtype: filter.filterType === "user" ? `user:${filter.value}` : `keyword:${filter.value}`,
      rawJson: post,
    };
  });
}

export async function collectThreads(
  filters: ThreadsFilter[],
  entities: TrackedEntity[]
): Promise<NewIngestedItem[]> {
  const token = process.env.THREADS_ACCESS_TOKEN;
  if (!token) throw new Error("THREADS_ACCESS_TOKEN not set");

  const allItems: NewIngestedItem[] = [];
  const seenIds = new Set<string>();

  for (const filter of filters) {
    try {
      const posts = filter.filterType === "user"
        ? await fetchByUser(filter.value, token)
        : await fetchByKeyword(filter.value, token);

      for (const item of mapPosts(posts, entities, filter)) {
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
