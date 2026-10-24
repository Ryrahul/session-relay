import type { SessionListItem } from "@session-relay/shared";
import type { RelayClient } from "./client.js";
import { ago } from "./ui.js";

const line = (s: SessionListItem) =>
  `- ${s.title} · ${s.author.name} · ${s.tool}${s.branch ? ` · ${s.branch}` : ""} · ${ago(s.created_at)} · \`${s.id}\`` +
  `${s.assignee ? ` · for ${s.assignee.name}` : ""}${s.comment_count ? ` · ${s.comment_count} comments` : ""}`;

/** Plain-text digest of the last `days` days, for the terminal and for agents. */
export async function renderDigest(client: RelayClient, days: number): Promise<string> {
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const [me, shared, forMe, activity] = await Promise.all([
    client.me(),
    client.list({ since, limit: 100 }),
    client.list({ assignee: "me", limit: 20 }),
    client.activity(days),
  ]);
  const period = days === 1 ? "the last 24 hours" : `the last ${days} days`;
  const out: string[] = [`# ${me.org.name}: ${period}`];

  out.push(
    `\n${shared.sessions.length} shared · ${activity.pickups.length} picked up · ${activity.comments.length} comments`,
  );
  if (forMe.sessions.length) out.push(`\n## For you\n${forMe.sessions.map(line).join("\n")}`);

  const byRepo = new Map<string, SessionListItem[]>();
  for (const s of shared.sessions) byRepo.set(s.repo, [...(byRepo.get(s.repo) ?? []), s]);
  if (byRepo.size) {
    out.push("\n## Shared");
    for (const [repo, list] of [...byRepo].sort((a, b) => b[1].length - a[1].length)) {
      out.push(`\n### ${repo}\n${list.map(line).join("\n")}`);
    }
  }
  if (activity.pickups.length) {
    out.push(
      `\n## Picked up\n${activity.pickups.map((p) => `- ${p.by.name} picked up "${p.session_title}" (${p.session_author.name}) · ${ago(p.at)} · \`${p.session_id}\``).join("\n")}`,
    );
  }
  if (activity.comments.length) {
    out.push(
      `\n## Comments\n${activity.comments
        .slice(0, 20)
        .map((c) => `- ${c.author.name} on "${c.session_title}" · ${ago(c.created_at)}: ${c.body.replace(/\s+/g, " ").slice(0, 200)}`)
        .join("\n")}`,
    );
  }
  if (!shared.sessions.length && !activity.pickups.length && !activity.comments.length) out.push(`\nNothing happened in ${period}.`);
  return out.join("\n");
}
