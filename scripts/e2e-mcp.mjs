// Talks to `relay mcp` exactly like an agent would (stdio MCP client).
// Usage: node scripts/e2e-mcp.mjs <repo dir> <relay config> <expected session id>
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";

const [cwd, config, expectId] = process.argv.slice(2);
const cli = fileURLToPath(new URL("../packages/cli/dist/index.js", import.meta.url));
const transport = new StdioClientTransport({ command: process.execPath, args: [cli, "mcp"], cwd, env: { ...process.env, RELAY_CONFIG: config } });
const client = new Client({ name: "e2e-check", version: "1.0.0" });
await client.connect(transport);

const fail = (msg) => {
  console.error(`MCP check failed: ${msg}`);
  process.exit(1);
};
const text = (r) => r.content.map((c) => c.text).join("\n");

const tools = (await client.listTools()).tools.map((t) => t.name).sort();
const want = ["get_session", "list_sessions", "search_sessions", "share_current_session"];
if (JSON.stringify(tools) !== JSON.stringify(want)) fail(`tools were ${tools}`);

const listed = text(await client.callTool({ name: "list_sessions", arguments: {} }));
if (!listed.includes(expectId)) fail(`list_sessions did not include ${expectId}:\n${listed}`);

const found = text(await client.callTool({ name: "search_sessions", arguments: { query: "math" } }));
if (!found.includes(expectId)) fail(`search_sessions did not find ${expectId}`);

const handoff = text(await client.callTool({ name: "get_session", arguments: { id: expectId } }));
if (!handoff.includes("## Goal") || !handoff.includes("## Conversation")) fail(`get_session output:\n${handoff}`);

const missing = await client.callTool({ name: "get_session", arguments: { id: "rs_DOESNOTEXIST" } });
if (!missing.isError) fail("get_session on a missing id should be an error");

await client.close();
console.log(`MCP OK: tools ${tools.join(", ")}; list, search and get_session returned ${expectId}`);
