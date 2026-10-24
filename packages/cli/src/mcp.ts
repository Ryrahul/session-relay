import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SourceTool } from "@session-relay/shared";
import { z } from "zod";
import { RelayClient, resolvePeople, resolvePerson } from "./client.js";
import { describeTemplate, matchTemplate, missingSections, type SessionPatch } from "@session-relay/shared";
import { repoInfo } from "./git.js";
import { renderHandoff } from "@session-relay/shared";
import { recordPickup } from "./pickups.js";
import { renderDigest } from "./digest.js";
import { describeRedactions, prepareShare, uploadShare } from "./share.js";
import { ago } from "./ui.js";
import { VERSION } from "./version.js";


const INSTRUCTIONS = `Session Relay shares coding-agent sessions between teammates (Claude Code, Codex, OpenCode, ZCode, Gemini CLI, Copilot CLI, Cursor).
- To continue someone's work: search_sessions or list_sessions, then get_session (mode "tail") and read the summary, next steps and recent conversation before acting.
- Handoffs assigned to you: list_sessions with for_me.
- To share this session: call share_template first (some repos ask for extra sections), then write an honest handoff summary (goal, decisions, done, next, open questions, plus the template's sections; never secrets) and call share_current_session.
- To fix or extend a share you made (new next steps, PR link, who it's for): update_session.
- "What did the team do today/this week?": team_activity.
- To leave a note on someone's session (a question, "picked this up", a finding): comment_on_session. Comments show up in get_session.`;

/** Which agent launched us, from the MCP client name. */
function callerTool(name?: string): SourceTool | undefined {
  const n = (name ?? "").toLowerCase();
  if (n.includes("claude")) return "claude-code";
  if (n.includes("opencode")) return "opencode";
  if (n.includes("codex")) return "codex";
  if (n.includes("zcode")) return "zcode";
  if (n.includes("gemini")) return "gemini";
  if (n.includes("copilot")) return "copilot";
  if (n.includes("cursor")) return "cursor";
  return undefined;
}

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const fail = (err: unknown) => ({ ...text(`Error: ${(err as Error).message}`), isError: true });

function formatList(rows: Awaited<ReturnType<RelayClient["list"]>>["sessions"]): string {
  if (!rows.length) return "No shared sessions found.";
  return rows
    .map(
      (s) =>
        `- ${s.id} · "${s.title}" · ${s.author.name} · ${s.tool} · ${s.branch ?? "-"} · ${ago(s.created_at)}` +
        `${s.assignee ? ` · for ${s.assignee.name}` : ""}${s.pr_url ? ` · ${s.pr_url}` : ""}${s.comment_count ? ` · ${s.comment_count} comments` : ""}` +
        `\n  goal: ${s.goal.slice(0, 200)}`,
    )
    .join("\n");
}

export function createMcpServer(getClient: () => Promise<RelayClient> = RelayClient.fromConfig): McpServer {
  const server = new McpServer({ name: "session-relay", version: VERSION }, { instructions: INSTRUCTIONS });
  const currentRepo = () => repoInfo().then((r) => r.repo).catch(() => undefined);

  server.registerTool(
    "list_sessions",
    {
      description:
        "List sessions teammates have shared. Defaults to the current repo; pass all_repos to see everything. for_me lists handoffs assigned to you (from any repo).",
      inputSchema: {
        author: z.string().optional().describe('Name, email or "me"'),
        tool: SourceTool.optional(),
        branch: z.string().optional(),
        file: z.string().optional().describe("Only sessions that touched this file (part of the path is fine)"),
        for_me: z.boolean().optional().describe("Only handoffs assigned to you"),
        all_repos: z.boolean().optional(),
        limit: z.number().int().min(1).max(50).optional(),
      },
    },
    async ({ author, tool, branch, file, for_me, all_repos, limit }) => {
      try {
        const client = await getClient();
        const repo = all_repos || for_me ? undefined : await currentRepo();
        const { sessions } = await client.list({ repo, author, tool, branch, file, assignee: for_me ? "me" : undefined, limit: limit ?? 10 });
        const head = for_me ? "Handoffs for you:\n" : repo ? `Shared sessions for ${repo}:\n` : "Shared sessions:\n";
        return text(head + formatList(sessions));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "search_sessions",
    {
      description:
        'Full-text search over shared sessions (titles, summaries, messages). The query can include "file:<path>" and "branch:<name>" filters.',
      inputSchema: {
        query: z.string().min(1),
        this_repo_only: z.boolean().optional().describe("Limit to the current repo (default false)"),
        author: z.string().optional(),
      },
    },
    async ({ query, this_repo_only, author }) => {
      try {
        const client = await getClient();
        const repo = this_repo_only ? await currentRepo() : undefined;
        const { sessions } = await client.list({ q: query, repo, author, limit: 10 });
        return text(formatList(sessions));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "get_session",
    {
      description:
        'Load a shared session as a handoff: summary, decisions, next steps, files and conversation. mode "tail" (default) = summary + recent messages; "summary" = summary only; "full" = full transcript, paged with offset.',
      inputSchema: {
        id: z.string(),
        mode: z.enum(["summary", "tail", "full"]).optional(),
        tail: z.number().int().min(1).max(500).optional(),
        offset: z.number().int().min(0).optional(),
      },
    },
    async ({ id, mode, tail, offset }) => {
      try {
        const client = await getClient();
        const s = await client.get(id, mode ?? "tail", { tail, offset, pickup: !offset });
        // Loading a session to work on it: the next share in this repo continues it.
        const root = await repoInfo().then((r) => r.root).catch(() => null);
        if (root) await recordPickup(root, s.id);
        let out = renderHandoff(s);
        const end = s.message_offset + s.messages.length;
        if (mode === "full" && end < s.message_total) out += `\n(More messages: call get_session with mode "full" and offset ${end}.)`;
        if (s.diff) out += `\n(Uncommitted changes are attached: call get_session_diff with id "${s.id}".)`;
        return text(out);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "share_current_session",
    {
      description:
        "Share the session you are in right now with the team. Write the summary yourself from the conversation: it is what teammates read first. Never include secrets.",
      inputSchema: {
        goal: z.string().describe("What this session is trying to achieve"),
        decisions: z.array(z.string()).optional().describe("Key decisions and why"),
        done: z.array(z.string()).optional(),
        next: z.array(z.string()).optional().describe("Concrete next steps for whoever continues"),
        open_questions: z.array(z.string()).optional(),
        title: z.string().max(200).optional(),
        include: z.enum(["summary", "summary+tail", "full"]).optional().describe('Default "summary+tail"'),
        people: z.array(z.string()).optional().describe("Names or emails who can see it; omit for the whole team"),
        continues: z
          .string()
          .optional()
          .describe('Id of the shared session this work continues. Defaults to the one loaded with get_session in this repo; "none" to unlink.'),
        sections: z.array(z.object({ title: z.string(), items: z.array(z.string()) })).optional().describe("Extra sections, e.g. the ones share_template asks for"),
        include_diff: z.boolean().optional().describe("Attach the uncommitted changes in this repo (redacted), so the next person gets the exact code state"),
        ignore_template: z.boolean().optional().describe("Share even if the repo's template has required sections you left empty"),
        for: z.string().optional().describe("Name or email of the teammate this handoff is for"),
        pr_url: z.string().optional().describe('Pull request URL. Defaults to the current branch\'s open PR (via gh); "none" to leave out'),
      },
    },
    async (args) => {
      try {
        const client = await getClient();
        const tool = callerTool(server.server.getClientVersion()?.name);
        const prepared = await prepareShare(client, {
          tool,
          include: args.include ?? "summary+tail",
          title: args.title,
          people: args.people,
          continues: args.continues,
          assign: args.for,
          pr: args.pr_url,
          diff: args.include_diff,
          summary: {
            goal: args.goal,
            decisions: args.decisions ?? [],
            done: args.done ?? [],
            next: args.next ?? [],
            open_questions: args.open_questions ?? [],
            sections: (args.sections ?? []).map((x) => ({ title: x.title.slice(0, 60), items: x.items })),
          },
        });
        const { session } = prepared.built;
        if (!args.ignore_template) {
          const t = matchTemplate((await client.me()).settings.share_templates ?? [], session.repo);
          const missing = missingSections(t, session.summary);
          if (missing.length && t) {
            return fail(
              new Error(
                `Not shared yet: this repo's handoff template requires ${missing.join(", ")}. Add them as \`sections\` and call again (or pass ignore_template if they don't apply).\n\n${describeTemplate(t)}`,
              ),
            );
          }
        }
        const { id, continues } = await uploadShare(client, prepared);
        return text(
          `Shared as ${id}: "${session.title}" (${session.include}, ${session.messages.length} messages, ${session.visibility.team ? "whole team" : "selected people"}). ${describeRedactions(prepared.built.redactions)}${continues ? `\nContinues ${continues}.` : ""}${args.for ? `\nFor ${args.for}.` : ""}${session.pr_url ? `\nPR ${session.pr_url}.` : ""}\nTeammates can load it with get_session("${id}") or \`relay pull ${id}\`.`,
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "get_session_diff",
    {
      description:
        "The uncommitted changes a teammate attached to a shared session, as a unified diff. Use it to see exact code state; to apply it, write it to a file and run `git apply`.",
      inputSchema: { id: z.string(), max_chars: z.number().int().min(1000).max(500000).optional() },
    },
    async ({ id, max_chars }) => {
      try {
        const client = await getClient();
        const diff = await client.diff(id);
        const max = max_chars ?? 100_000;
        return text(diff.length > max ? `${diff.slice(0, max)}\n[cut at ${max} characters of ${diff.length}; ask for more with max_chars]` : diff);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "share_template",
    {
      description: "The handoff template for the current repo: extra sections (some required) and instructions to follow when sharing. Call it before share_current_session.",
      inputSchema: {},
    },
    async () => {
      try {
        const client = await getClient();
        const repo = await currentRepo();
        if (!repo) return text("Not in a git repo; no template applies.");
        const { template: t } = await client.template(repo);
        return text(t ? describeTemplate(t) : `No handoff template for ${repo}: the standard summary is enough.`);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "team_activity",
    {
      description: "What the team did recently: new shares by repo, handoffs for you, who picked up what, and new comments.",
      inputSchema: { days: z.number().int().min(1).max(30).optional().describe("Look back this many days (default 1)") },
    },
    async ({ days }) => {
      try {
        const client = await getClient();
        return text(await renderDigest(client, days ?? 1));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "comment_on_session",
    {
      description:
        "Leave a short note on a shared session for the team: a question, a finding, or that you picked it up. Never include secrets.",
      inputSchema: { id: z.string(), body: z.string().min(1).max(4000) },
    },
    async ({ id, body }) => {
      try {
        const client = await getClient();
        await client.comment(id, body);
        return text(`Commented on ${id}.`);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "update_session",
    {
      description:
        "Change a share you made (or any share, if you're an admin): title, summary fields, who it's for, the PR link or visibility. Summary lists you pass replace the old ones; use add_next to append next steps.",
      inputSchema: {
        id: z.string(),
        title: z.string().max(200).optional(),
        goal: z.string().optional(),
        decisions: z.array(z.string()).optional(),
        done: z.array(z.string()).optional(),
        next: z.array(z.string()).optional(),
        add_next: z.array(z.string()).optional().describe("Next steps to append to the existing ones"),
        open_questions: z.array(z.string()).optional(),
        sections: z.array(z.object({ title: z.string(), items: z.array(z.string()) })).optional().describe("Replaces the extra sections"),
        for: z.string().optional().describe('Teammate name or email, or "none"'),
        pr_url: z.string().optional().describe('Pull request URL, or "none"'),
        people: z.array(z.string()).optional().describe("Make it visible only to these people; an empty list makes it visible to the whole team"),
        publish: z.boolean().optional().describe("Publish a draft (saved automatically at session end) to the team, or to `people`"),
      },
    },
    async (args) => {
      try {
        const client = await getClient();
        const patch: SessionPatch = {};
        if (args.title) patch.title = args.title;
        const summaryKeys = ["goal", "decisions", "done", "next", "add_next", "open_questions", "sections"] as const;
        if (summaryKeys.some((k) => args[k] !== undefined)) {
          const cur = (await client.get(args.id, "summary")).summary;
          patch.summary = {
            goal: args.goal ?? cur.goal,
            decisions: args.decisions ?? cur.decisions,
            done: args.done ?? cur.done,
            next: [...(args.next ?? cur.next), ...(args.add_next ?? [])],
            open_questions: args.open_questions ?? cur.open_questions,
            sections: args.sections ?? cur.sections ?? [],
          };
        }
        if (args.for) patch.assignee = args.for === "none" ? null : await resolvePerson(client, args.for);
        if (args.pr_url) patch.pr_url = args.pr_url === "none" ? null : args.pr_url;
        if (args.people) {
          patch.visibility = args.people.length ? { team: false, people: await resolvePeople(client, args.people) } : { team: true, people: [] };
        }
        if (args.publish) {
          patch.draft = false;
          patch.visibility ??= { team: true, people: [] };
        }
        if (!Object.keys(patch).length) return text("Nothing to change.");
        await client.update(args.id, patch);
        return text(`Updated ${args.id} (${Object.keys(patch).join(", ")}).`);
      } catch (err) {
        return fail(err);
      }
    },
  );

  return server;
}

export async function runMcp(): Promise<void> {
  await createMcpServer().connect(new StdioServerTransport());
}
