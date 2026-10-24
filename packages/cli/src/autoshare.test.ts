import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { setupClaudeAutoShare } from "./commands/setup.js";

describe("relay setup --auto-share (Claude Code SessionEnd hook)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "relay-autoshare-"));
  const file = path.join(dir, "settings.json");
  afterAll(() => rm(dir, { recursive: true, force: true }));
  const read = async () => JSON.parse(await readFile(file, "utf8"));
  const other = { type: "command", command: "echo bye" };

  it("adds the hook, keeps other settings and hooks, and doesn't duplicate on re-run", async () => {
    await writeFile(file, JSON.stringify({ theme: "dark", hooks: { SessionEnd: [{ hooks: [other] }], Stop: [{ hooks: [other] }] } }));
    await setupClaudeAutoShare(true, ["relay", "mcp"], {}, file);
    await setupClaudeAutoShare(true, ["relay", "mcp"], {}, file);
    const cfg = await read();
    expect(cfg.theme).toBe("dark");
    expect(cfg.hooks.Stop).toEqual([{ hooks: [other] }]);
    const commands = cfg.hooks.SessionEnd.flatMap((g: any) => g.hooks.map((h: any) => h.command));
    expect(commands).toEqual(["echo bye", '"relay" hook session-end --tool claude']);
  });

  it("passes RELAY_CONFIG through, and uses node + script when relay isn't on PATH", async () => {
    await setupClaudeAutoShare(true, ["/usr/bin/node", "/x/relay.js", "mcp"], { RELAY_CONFIG: "/c/a.json" }, file);
    const cmd = (await read()).hooks.SessionEnd.at(-1).hooks[0].command;
    expect(cmd).toBe('RELAY_CONFIG="/c/a.json" "/usr/bin/node" "/x/relay.js" hook session-end --tool claude');
  });

  it("off removes only the relay hook", async () => {
    await setupClaudeAutoShare(false, ["relay", "mcp"], {}, file);
    const cfg = await read();
    expect(cfg.hooks.SessionEnd).toEqual([{ hooks: [other] }]);
    await writeFile(file, JSON.stringify({ hooks: { SessionEnd: [{ hooks: [{ type: "command", command: "relay hook session-end --tool claude" }] }] } }));
    await setupClaudeAutoShare(false, ["relay", "mcp"], {}, file);
    expect(await read()).toEqual({});
  });
});
