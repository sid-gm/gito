import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";

export type ItemToCluster = {
  id: string;
  title: string | null;
  body: string | null;
  publishedAt: Date | null;
};

export type ActiveCluster = {
  id: string;
  label: string | null;
  itemCount: number;
  lastSeenAt: Date;
  suggestedKeywords: string[] | null;
  narrativeSummary: string | null;
};

export type Phase1Result = {
  // itemId → clusterId
  matched: Map<string, string>;
  unmatched: ItemToCluster[];
};

export type ClusterGroup = {
  itemIds: string[];
  label: string | null;
  keywords: string[];
};

const PHASE1_BATCH = 40; // items per LLM call
const PHASE1_CLUSTER_LIMIT = 75; // most recent labeled clusters shown to LLM

// Tweets/threads posts often carry the whole message in a short title — append a
// body snippet so the LLM has enough signal to match the item to a story.
function formatItemLine(item: ItemToCluster, index: number): string {
  const date = item.publishedAt ? item.publishedAt.toISOString().split("T")[0] : null;
  let text = `"${item.title ?? "(no title)"}"`;
  if ((item.title ?? "").length < 60 && item.body?.trim()) {
    text += ` | ${item.body.trim().replace(/\s+/g, " ").slice(0, 140)}`;
  }
  return `[${index + 1}] ${text}${date ? ` (${date})` : ""}`;
}

function formatClusterLine(cluster: ActiveCluster, index: number): string {
  const parts = [`[${index + 1}] "${cluster.label}"`];
  const keywords = (cluster.suggestedKeywords ?? []).slice(0, 5);
  if (keywords.length > 0) parts.push(`keywords: ${keywords.join(", ")}`);
  parts.push(`last seen ${cluster.lastSeenAt.toISOString().split("T")[0]}`);
  parts.push(`${cluster.itemCount} items`);
  if (cluster.narrativeSummary) {
    parts.push(cluster.narrativeSummary.split(". ")[0].slice(0, 140));
  }
  return parts.join(" — ");
}

// Phase 1: assign items to existing labeled clusters (batched).
// Items without a clear match are returned in `unmatched`.
export async function matchToExistingClusters(
  items: ItemToCluster[],
  activeClusters: ActiveCluster[]
): Promise<Phase1Result> {
  const labeled = activeClusters
    .filter((c) => c.label)
    .sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime())
    .slice(0, PHASE1_CLUSTER_LIMIT);

  if (labeled.length === 0 || items.length === 0) {
    return { matched: new Map(), unmatched: items };
  }

  const matched = new Map<string, string>();
  const unmatched: ItemToCluster[] = [];

  const clusterList = labeled.map(formatClusterLine).join("\n");

  for (let offset = 0; offset < items.length; offset += PHASE1_BATCH) {
    const batch = items.slice(offset, offset + PHASE1_BATCH);

    const itemList = batch.map(formatItemLine).join("\n");

    const prompt = `You are classifying news articles, tweets, and posts into existing story clusters.

Existing story clusters:
${clusterList}

New items to classify:
${itemList}

Rules:
- Assign an item to an existing cluster ONLY if it covers the same specific event, announcement, or development as that cluster.
- Sharing a person's name or a broad topic is NOT sufficient — the item must be about the same incident or thread.
- Different controversies, appointments, statements, or events involving the same person belong in separate clusters.
- Items from different dates may still belong in the same cluster if they are clearly about the same developing story or event.
- When in doubt, mark the item as "new".

Respond ONLY with a valid JSON object mapping each item number to a cluster number or "new".
Example: {"1": 2, "2": "new", "3": 1}`;

    try {
      const { text } = await generateText({
        model: openai("gpt-4o-mini"),
        prompt,
        maxOutputTokens: 400,
      });

      const raw = text.trim().replace(/```json\n?|\n?```/g, "").trim();
      const assignments = JSON.parse(raw) as Record<string, number | "new">;

      for (let i = 0; i < batch.length; i++) {
        const item = batch[i];
        const assignment = assignments[String(i + 1)];
        if (assignment === "new" || assignment === undefined) {
          unmatched.push(item);
        } else {
          const cluster = labeled[Number(assignment) - 1];
          if (cluster) {
            matched.set(item.id, cluster.id);
          } else {
            unmatched.push(item);
          }
        }
      }
    } catch (err) {
      console.error("[cluster/phase1] parse error:", err);
      // On failure, treat entire batch as unmatched so we don't silently lose items
      unmatched.push(...batch);
    }
  }

  return { matched, unmatched };
}

// Phase 2: group unmatched items into new clusters, generating labels and keywords.
// Every group gets a label — including singletons, so the next wave of items about
// the same story can match them in Phase 1 instead of spawning a duplicate cluster.
export async function groupNewItems(
  entityLabel: string,
  items: ItemToCluster[]
): Promise<ClusterGroup[]> {
  if (items.length === 0) return [];

  const itemList = items.map(formatItemLine).join("\n");

  const prompt = `You are grouping news articles, tweets, and posts about "${entityLabel}" into story clusters.

Articles:
${itemList}

Rules:
- Group items ONLY if they cover the same specific event, announcement, or incident — not just because they mention the same person.
- Each distinct controversy, appointment, statement, or event must be its own separate group.
- Items from different dates may still be grouped together if they are clearly about the same developing story or event.
- A bizarre or off-topic story (e.g. a casting call, satire, unrelated mention) should never be grouped with a legitimate news story even if they share a name.
- When in doubt, keep items in separate groups.

For EVERY group, including groups with a single item, provide a concise 3-6 word label and 3-5 search keywords to track this story.

Respond ONLY with valid JSON:
{"groups": [{"items": [1, 3], "label": "Brief Story Title", "keywords": ["keyword1", "keyword2"]}, {"items": [2], "label": "Other Story Title", "keywords": ["keyword3"]}]}`;

  try {
    const { text } = await generateText({
      model: openai("gpt-4o-mini"),
      prompt,
      maxOutputTokens: 500,
    });

    const raw = text.trim().replace(/```json\n?|\n?```/g, "").trim();
    const parsed = JSON.parse(raw) as {
      groups: { items: number[]; label: string | null; keywords: string[] }[];
    };

    return parsed.groups.map((g) => ({
      itemIds: g.items
        .map((idx) => items[idx - 1]?.id)
        .filter((id): id is string => Boolean(id)),
      label: g.label ?? null,
      keywords: g.keywords ?? [],
    }));
  } catch (err) {
    console.error("[cluster/phase2] parse error:", err);
    // On failure, each item becomes its own unlabeled singleton
    return items.map((item) => ({ itemIds: [item.id], label: null, keywords: [] }));
  }
}
