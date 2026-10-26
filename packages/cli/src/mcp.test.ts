import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { RelayClient } from "./client.js";
import { createMcpServer } from "./mcp.js";

const TOOLS = [
  "list_sessions",
  "search_sessions",
  "get_session",
  "share_current_session",
  "get_session_diff",
  "share_template",
  "team_activity",
  "comment_on_session",
  "update_session",
  "start_live",
  "live_status",
  "send_live_message",
  "check_live_inbox",
  "update_live",
  "stop_live",
];

const row = { id: "rs_1", title: "Fix webhook retries", author: { id: "u1", name: "Akshat" }, tool: "claude-code", branch: "main", created_at: new Date().toISOString(), goal: "retry hooks safely" };

/** An MCP client talking to our server in memory, with a fake Session Relay API behind it. */
async function connect(api: Partial<Record<keyof RelayClient, unknown>> = {}) {
  const server = createMcpServer(async () => api as unknown as RelayClient);
  const client = new Client({ name: "claude-code", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}
const textOf = (r: { content: unknown }) => (r.content as { text: string }[]).map((c) => c.text).join("\n");

describe("MCP server", () => {
  it("lists every tool with a title, all four hints, and a description for every input", async () => {
    const { tools } = await (await connect()).listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOLS].sort());
    for (const t of tools) {
      expect(t.title, t.name).toBeTruthy();
      expect(t.description, t.name).toBeTruthy();
      for (const hint of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"] as const) {
        expect(typeof t.annotations?.[hint], `${t.name}.${hint}`).toBe("boolean");
      }
      for (const [name, prop] of Object.entries(t.inputSchema.properties ?? {})) {
        expect((prop as { description?: string }).description, `${t.name}.${name}`).toBeTruthy();
      }
    }
  });

  it("marks only reading tools read-only, and only update_session (it overwrites fields) as destructive", async () => {
    const { tools } = await (await connect()).listTools();
    const by = Object.fromEntries(tools.map((t) => [t.name, t.annotations!]));
    for (const n of ["list_sessions", "search_sessions", "get_session", "get_session_diff", "share_template", "team_activity", "live_status"]) expect(by[n]!.readOnlyHint, n).toBe(true);
    for (const n of ["share_current_session", "comment_on_session", "send_live_message", "start_live", "stop_live"]) expect(by[n]!.readOnlyHint, n).toBe(false);
    expect(tools.filter((t) => t.annotations!.destructiveHint).map((t) => t.name)).toEqual(["update_session"]);
  });

  it("validates input and returns tool errors as results, not crashes", async () => {
    const client = await connect({
      list: async () => ({ sessions: [row] }),
      search: async () => ({ sessions: [row] }),
    });
    const list = await client.callTool({ name: "list_sessions", arguments: { all_repos: true } });
    expect(textOf(list)).toContain('rs_1 · "Fix webhook retries" · Akshat');
    const search = await client.callTool({ name: "search_sessions", arguments: { query: "retry" } });
    expect(textOf(search)).toContain("rs_1");
    const bad = await client.callTool({ name: "search_sessions", arguments: { query: "" } });
    expect(bad.isError).toBe(true);
    const failing = await client.callTool({ name: "get_session", arguments: { id: "rs_missing" } });
    expect(failing.isError).toBe(true);
    expect(textOf(failing)).toMatch(/^Error: /);
  });
});
