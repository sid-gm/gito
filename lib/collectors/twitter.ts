import type { NewIngestedItem, TrackedEntity } from "@/lib/db/schema";

// Sanitize a multi-platform queryString for Twitter API v2:
// - Uppercase boolean operators (or → OR, and → AND, not → NOT)
// - Strip bare :alias tokens (e.g. :sama) — HN-specific, invalid for Twitter
// - Keep field:value tokens like from:handle, to:handle
function toTwitterQuery(entity: TrackedEntity): string {
  const tokens = entity.queryString
    .split(/\s+/)
    .map((token) => {
      if (/^(or|and|not)$/i.test(token)) return token.toUpperCase();
      if (/^:[a-zA-Z]/i.test(token)) return null; // strip :alias
      return token;
    })
    .filter(Boolean) as string[];

  // Remove dangling boolean operators at the boundaries
  while (tokens.length > 0 && /^(OR|AND|NOT)$/.test(tokens[0])) tokens.shift();
  while (tokens.length > 0 && /^(OR|AND)$/.test(tokens[tokens.length - 1])) tokens.pop();

  return tokens.join(" ").trim() || entity.label;
}

interface Tweet {
  id: string;
  text: string;
  created_at: string;
  author_id: string;
  [key: string]: unknown;
}

interface TwitterUser {
  id: string;
  name: string;
  username: string;
}

export async function collectTwitter(
  entity: TrackedEntity
): Promise<NewIngestedItem[]> {
  const query = encodeURIComponent(
    `${toTwitterQuery(entity)} lang:en`
  );

  const res = await fetch(
    `https://api.twitter.com/2/tweets/search/recent?query=${query}&max_results=25&tweet.fields=created_at,author_id&expansions=author_id&user.fields=username,name`,
    {
      headers: {
        Authorization: `Bearer ${process.env.TWITTER_BEARER_TOKEN}`,
      },
    }
  );

  if (!res.ok) throw new Error(`Twitter API error: ${res.status}`);

  const data = (await res.json()) as {
    data?: Tweet[];
    includes?: { users?: TwitterUser[] };
  };

  if (!data.data) return [];

  const usersById = new Map(
    (data.includes?.users ?? []).map((u) => [u.id, u])
  );

  return data.data.map((tweet) => {
    const user = usersById.get(tweet.author_id);
    const cleanBody = tweet.text.replace(/^RT @\w+:\s*/i, "").trim();
    return {
      entityId: entity.id,
      platform: "twitter" as const,
      externalId: tweet.id,
      url: `https://twitter.com/i/web/status/${tweet.id}`,
      title: null,
      body: cleanBody,
      author: user ? `@${user.username}` : tweet.author_id,
      publishedAt: new Date(tweet.created_at),
      rawJson: tweet,
    };
  });
}
