import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { SourceTool } from "@session-relay/shared";
import { z } from "zod";
import { RelayClient } from "./client.js";
import { repoInfo } from "./git.js";
import { renderHandoff } from "./handoff.js";
import { recordPickup } from "./pickups.js";
import { describeRedactions, prepareShare, uploadShare } from "./share.js";
import { ago } from "./ui.js";
import { VERSION } from "./version.js";


const INSTRUCTIONS = `Session Relay shares coding-agent sessions between teammates (Claude Code, Codex, OpenCode, ZCode).
- To continue someone's work: search_sessions or list_sessions, then get_session (mode "tail") and read the summary, next steps and recent conversation before acting.
- To share this session: write an honest handoff summary (goal, decisions, done, next, open questions; never secrets) and call share_current_session.`;

/** Which agent launched us, from the MCP client name. */
function callerTool(name?: string): SourceTool | undefined {
  const n = (name ?? "").toLowerCase();
  if (n.includes("claude")) return "claude-code";
  if (n.includes("opencode")) return "opencode";
  if (n.includes("codex")) return "codex";
  if (n.includes("zcode")) return "zcode";
  return undefined;
}

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const fail = (err: unknown) => ({ ...text(`Error: ${(err as Error).message}`), isError: true });

function formatList(rows: Awaited<ReturnType<RelayClient["list"]>>["sessions"]): string {
  if (!rows.length) return "No shared sessions found.";
  return rows
    .map((s) => `- ${s.id} · "${s.title}" · ${s.author.name} · ${s.tool} · ${s.branch ?? "-"} · ${ago(s.created_at)}\n  goal: ${s.goal.slice(0, 200)}`)
    .join("\n");
}

export function createMcpServer(getClient: () => Promise<RelayClient> = RelayClient.fromConfig): McpServer {
  const server = new McpServer({ name: "session-relay", version: VERSION }, { instructions: INSTRUCTIONS });
  const currentRepo = () => repoInfo().then((r) => r.repo).catch(() => undefined);

  server.registerTool(
    "list_sessions",
    {
      description: "List sessions teammates have shared. Defaults to the current repo; pass all_repos to see everything.",
      inputSchema: {
        author: z.string().optional().describe('Name, email or "me"'),
        tool: z.enum(["claude-code", "codex", "opencode", "zcode"]).optional(),
        branch: z.string().optional(),
        all_repos: z.boolean().optional(),
        limit: z.number().int().min(1).max(50).optional(),
      },
    },
    async ({ author, tool, branch, all_repos, limit }) => {
      try {
        const client = await getClient();
        const repo = all_repos ? undefined : await currentRepo();
        const { sessions } = await client.list({ repo, author, tool, branch, limit: limit ?? 10 });
        return text((repo ? `Shared sessions for ${repo}:\n` : "Shared sessions:\n") + formatList(sessions));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "search_sessions",
    {
      description: "Full-text search over shared sessions (titles, summaries, messages).",
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
        const s = await client.get(id, mode ?? "tail", { tail, offset });
        // Loading a session to work on it: the next share in this repo continues it.
        const root = await repoInfo().then((r) => r.root).catch(() => null);
        if (root) await recordPickup(root, s.id);
        let out = renderHandoff(s);
        const end = s.message_offset + s.messages.length;
        if (mode === "full" && end < s.message_total) out += `\n(More messages: call get_session with mode "full" and offset ${end}.)`;
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
          summary: {
            goal: args.goal,
            decisions: args.decisions ?? [],
            done: args.done ?? [],
            next: args.next ?? [],
            open_questions: args.open_questions ?? [],
          },
        });
        const { session } = prepared.built;
        const { id, continues } = await uploadShare(client, prepared);
        return text(
          `Shared as ${id}: "${session.title}" (${session.include}, ${session.messages.length} messages, ${session.visibility.team ? "whole team" : "selected people"}). ${describeRedactions(prepared.built.redactions)}${continues ? `\nContinues ${continues}.` : ""}\nTeammates can load it with get_session("${id}") or \`relay pull ${id}\`.`,
        );
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
