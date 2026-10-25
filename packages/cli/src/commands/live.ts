import type { LiveMessage, LiveSession, SourceTool } from "@session-relay/shared";
import { RelayClient, resolvePerson } from "../client.js";
import { repoInfo } from "../git.js";
import { addLive, dropLive, liveForCwd, loadLive, type LocalLive } from "../live.js";
import { ago, toolLabel } from "../ui.js";
import { liveHooksInstalled } from "./setup.js";

const TOOLS: Record<string, SourceTool> = { claude: "claude-code", "claude-code": "claude-code", opencode: "opencode", codex: "codex", zcode: "zcode", gemini: "gemini", copilot: "copilot", cursor: "cursor" };

export function formatLiveMessage(m: LiveMessage): string {
  const who = `${m.from.name}${m.from_agent ? "'s agent" : ""}`;
  const kind = m.kind === "question" ? " asks" : m.kind === "answer" ? ` answers #${m.reply_to}` : "";
  return `#${m.id} ${who}${kind} · ${ago(m.created_at)}\n  ${m.body.replace(/\n/g, "\n  ")}`;
}

export function formatLiveRow(l: LiveSession, meId?: string): string {
  const who = l.owner.id === meId ? `${l.owner.name} (you)` : l.owner.name;
  const head = `${l.state === "live" ? "●" : "○"} ${who} · ${l.repo}${l.branch ? ` · ${l.branch}` : ""}${l.tool ? ` · ${toolLabel(l.tool).trim()}` : ""} · ${l.state === "live" ? "active" : "away"} ${ago(l.heartbeat_at)}`;
  const lines = [head, `  ${l.id}${l.title ? ` · ${l.title}` : ""}${l.status ? ` · now: ${l.status}` : ""}${l.autonomy ? " · acts on messages without asking" : ""}`];
  if (l.files.length) lines.push(`  files: ${l.files.slice(0, 5).map((f) => f.path).join(", ")}${l.files.length > 5 ? ", …" : ""}`);
  if (l.owner.id === meId && l.unread) lines.push(`  ${l.unread} unread message${l.unread === 1 ? "" : "s"}`);
  return lines.join("\n");
}

/** "everyone" (all live in this repo), a live session id, or a teammate's name or email. */
export async function resolveLiveTarget(client: RelayClient, to: string, repo?: string): Promise<{ to_live?: string; to_user?: string; to_repo?: string }> {
  const t = to.trim().replace(/^@/, "");
  if (["everyone", "all", "team"].includes(t.toLowerCase())) {
    if (!repo) throw new Error('"everyone" means everyone live in this repo; run it inside the repo');
    return { to_repo: repo };
  }
  if (/^lv_\w+$/.test(t)) return { to_live: t };
  return { to_user: await resolvePerson(client, t) };
}

/** relay live start: go live in this repo. */
export async function liveStart(opts: { title?: string; auto?: boolean; tool?: string }): Promise<LocalLive> {
  const client = await RelayClient.fromConfig();
  const repo = await repoInfo();
  const tool = opts.tool ? TOOLS[opts.tool.toLowerCase()] : undefined;
  if (opts.tool && !tool) throw new Error(`Unknown tool "${opts.tool}"`);
  const existing = await liveForCwd(repo.root, tool);
  if (existing) {
    const still = await client.liveGet(existing.id).catch(() => null);
    if (still && still.state !== "ended") return existing;
    await dropLive(existing.id);
  }
  const { id } = await client.liveStart({ repo: repo.repo, branch: repo.branch, tool, title: opts.title, autonomy: Boolean(opts.auto) });
  const entry: LocalLive = { id, root: repo.root, repo: repo.repo, tool, started: new Date().toISOString() };
  await addLive(entry);
  return entry;
}

export async function liveCommand(action: string | undefined, args: string[], opts: { title?: string; auto?: boolean; tool?: string; question?: boolean; all?: boolean; json?: boolean }) {
  const client = await RelayClient.fromConfig();
  const here = await repoInfo().catch(() => null);
  const mine = here ? await liveForCwd(here.root) : null;

  switch (action ?? "status") {
    case "start": {
      const entry = await liveStart(opts);
      console.log(`Live in ${entry.repo} as ${entry.id}.`);
      const hooks = await liveHooksInstalled();
      if (hooks.length) console.log(`Teammates' messages reach ${hooks.join(" and ")} between steps. By default your agent shows them to you before acting.`);
      else console.log("No live hooks installed: messages arrive when your agent calls check_live_inbox, or with relay live inbox. For automatic delivery: relay setup --live on");
      const others = (await client.liveList()).live.filter((l) => l.repo === entry.repo && l.id !== entry.id);
      if (others.length) console.log(`\nAlso live here:\n${others.map((l) => formatLiveRow(l)).join("\n")}`);
      return;
    }
    case "status":
    case "who": {
      const { live } = await client.liveList();
      const me = (await client.me()).user.id;
      if (opts.json) return console.log(JSON.stringify(live, null, 2));
      if (!live.length) return console.log("Nobody is working live right now. Start with: relay live start (or /live in your agent)");
      const sorted = [...live].sort((a, b) => Number(b.repo === here?.repo) - Number(a.repo === here?.repo));
      console.log(sorted.map((l) => formatLiveRow(l, me)).join("\n\n"));
      return;
    }
    case "send": {
      const [to, ...words] = args;
      const body = words.join(" ").trim();
      if (!to || !body) throw new Error('Usage: relay live send <name|everyone|lv_id> "message"');
      const target = await resolveLiveTarget(client, to, here?.repo);
      const r = await client.liveSend({ ...target, from_live: mine?.id, body, kind: opts.question ? "question" : "message", from_agent: false });
      console.log(`Sent to ${r.people.join(", ")} (${r.delivered_to} live session${r.delivered_to === 1 ? "" : "s"}): #${r.ids.join(", #")}`);
      return;
    }
    case "reply": {
      const [id, ...words] = args;
      const msg = Number(String(id ?? "").replace(/^#/, ""));
      const body = words.join(" ").trim();
      if (!msg || !body) throw new Error('Usage: relay live reply <message number> "answer"');
      if (!mine) throw new Error("Not live in this repo. Start with relay live start");
      const thread = await client.liveGet(mine.id);
      const orig = thread.messages.find((m) => m.id === msg);
      if (!orig) throw new Error(`Message #${msg} isn't in this live session`);
      const r = await client.liveSend({ from_live: mine.id, ...(orig.from_live ? { to_live: orig.from_live } : { to_user: orig.from.id }), body, kind: "answer", reply_to: msg });
      console.log(`Answered ${orig.from.name}: #${r.ids.join(", #")}`);
      return;
    }
    case "inbox": {
      if (!mine) throw new Error("Not live in this repo. Start with relay live start");
      const r = await client.livePoll(mine.id, {});
      if (r.ended) {
        await dropLive(mine.id);
        return console.log("This live session has ended.");
      }
      if (!r.messages.length) return console.log("No new messages.");
      console.log(r.messages.map(formatLiveMessage).join("\n\n"));
      if (r.more) console.log("\n(more waiting: run relay live inbox again)");
      return;
    }
    case "watch": {
      if (!mine) throw new Error("Not live in this repo. Start with relay live start");
      // A person watching: shows messages without taking them from the agent.
      let last = 0;
      console.log(`Watching ${mine.id} (Ctrl-C to stop). Your agent still gets these messages.`);
      for (;;) {
        const d = await client.liveGet(mine.id).catch((e: Error) => (console.error(e.message), null));
        if (d) {
          for (const m of d.messages.filter((x) => x.id > last)) {
            if (last || !m.read) console.log(`${m.to_live === mine.id ? "→ you" : `you → ${m.to.name}`}  ${formatLiveMessage(m)}\n`);
          }
          last = Math.max(last, ...d.messages.map((m) => m.id));
          if (d.state === "ended") return console.log("The live session ended.");
        }
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
    case "auto": {
      const on = (args[0] ?? "").toLowerCase();
      if (!["on", "off"].includes(on)) throw new Error("Usage: relay live auto on|off");
      if (!mine) throw new Error("Not live in this repo. Start with relay live start");
      await client.liveUpdate(mine.id, { autonomy: on === "on" });
      console.log(
        on === "on"
          ? "Your agent may now act on teammates' messages without asking you first (it still tells you what it did). Turn off with: relay live auto off"
          : "Your agent will show teammates' messages to you and ask before acting on them.",
      );
      return;
    }
    case "stop":
    case "end": {
      const targets = opts.all ? await loadLive() : mine ? [mine] : [];
      if (!targets.length) return console.log("Not live in this repo.");
      for (const t of targets) {
        await client.liveEnd(t.id).catch(() => undefined);
        await dropLive(t.id);
        console.log(`Ended ${t.id} (${t.repo}).`);
      }
      return;
    }
    default:
      throw new Error(`Unknown action "${action}". Use start, status, send, reply, inbox, watch, auto or stop.`);
  }
}
