export interface RedditPost {
  post_id: string;
  title: string;
  text: string;
  url: string;
  permalink: string;
  author: string;
  subreddit: string;
  created_utc_iso: string;
  score: number;
  upvote_ratio: number;
  num_comments: number;
  engagement_level: string;
  score_per_hour: number;
  comments_per_hour: number;
  link_flair_text: string | null;
  is_controversial: boolean;
  [key: string]: unknown;
}

interface RedditListing {
  data: {
    children: Array<{
      data: {
        id: string;
        title: string;
        selftext: string;
        url: string;
        permalink: string;
        author: string;
        subreddit: string;
        created_utc: number;
        score: number;
        upvote_ratio: number;
        num_comments: number;
        link_flair_text: string | null;
      };
    }>;
  };
}

const REDDIT_HEADERS = {
  "User-Agent": "gito-sma-tool/1.0 (monitoring tool)",
};

function engagementLevel(score: number): string {
  if (score < 10) return "low";
  if (score < 100) return "medium";
  return "high";
}

async function fetchSubredditPosts(
  subreddit: string,
  limit: number
): Promise<RedditPost[]> {
  const url = `https://www.reddit.com/r/${subreddit}/new.json?limit=${Math.min(limit, 100)}`;
  const res = await fetch(url, { headers: REDDIT_HEADERS });
  if (!res.ok) throw new Error(`Reddit error for r/${subreddit}: ${res.status} ${await res.text()}`);

  const listing = await res.json() as RedditListing;
  const now = Date.now() / 1000;

  return listing.data.children.map(({ data: p }) => {
    const ageHours = Math.max((now - p.created_utc) / 3600, 0.1);
    return {
      post_id: p.id,
      title: p.title,
      text: p.selftext || "",
      url: p.url,
      permalink: `https://reddit.com${p.permalink}`,
      author: p.author,
      subreddit: p.subreddit,
      created_utc_iso: new Date(p.created_utc * 1000).toISOString(),
      score: p.score,
      upvote_ratio: p.upvote_ratio,
      num_comments: p.num_comments,
      engagement_level: engagementLevel(p.score),
      score_per_hour: Math.round((p.score / ageHours) * 100) / 100,
      comments_per_hour: Math.round((p.num_comments / ageHours) * 100) / 100,
      link_flair_text: p.link_flair_text,
      is_controversial: p.upvote_ratio < 0.6,
    };
  });
}

class RedditPostQuery {
  constructor(private subredditName: string, private limit: number) {}

  async all(): Promise<RedditPost[]> {
    return fetchSubredditPosts(this.subredditName, this.limit);
  }
}

class BatchRedditPostQuery {
  constructor(private subreddits: string[], private limit: number) {}

  async all(): Promise<RedditPost[]> {
    const results = await Promise.all(
      this.subreddits.map((sub) => fetchSubredditPosts(sub, this.limit))
    );
    return results.flat();
  }
}

export class RedditClient {
  static create(): RedditClient {
    return new RedditClient();
  }

  getNewPosts(params: {
    subredditName: string;
    limit: number;
    pageSize: number;
  }): RedditPostQuery {
    return new RedditPostQuery(params.subredditName, params.limit);
  }

  getBatchNewPosts(params: { subreddits: string[]; limit: number }): BatchRedditPostQuery {
    return new BatchRedditPostQuery(params.subreddits, params.limit);
  }
}
