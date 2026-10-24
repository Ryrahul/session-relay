import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { IncludeMode, SourceTool, Summary, type DetailMode, type SessionPatch } from "@session-relay/shared";
import { findSessions } from "../adapters/index.js";
import { RelayClient, resolvePeople, resolvePerson } from "../client.js";
import { repoInfo } from "../git.js";
import { renderHandoff } from "../handoff.js";
import { recordPickup } from "../pickups.js";
import { describeRedactions, prepareShare, relayDir, uploadShare, writeDryRun } from "../share.js";
import { ago, ask, choose, confirm, interactive, toolLabel } from "../ui.js";

interface ShareOpts {
  tool?: string;
  id?: string;
  latest?: boolean;
  include?: string;
  tail?: string;
  title?: string;
  people?: string;
  summaryFile?: string;
  dryRun?: boolean;
  yes?: boolean;
  json?: boolean;
  continues?: string;
  for?: string;
  pr?: string;
}

function parseTool(t?: string): SourceTool | undefined {
  if (!t) return undefined;
  const alias: Record<string, SourceTool> = { claude: "claude-code", "claude-code": "claude-code", opencode: "opencode", codex: "codex", zcode: "zcode" };
  const tool = alias[t.toLowerCase()];
  if (!tool) throw new Error(`Unknown tool "${t}". Use claude, opencode, codex or zcode.`);
  return tool;
}

/** relay sessions: local sessions for this repo, across tools. */
export async function localSessions(opts: { tool?: string }): Promise<void> {
  const repo = await repoInfo();
  const refs = await findSessions(repo.root, parseTool(opts.tool));
  if (!refs.length) return console.log(`No local sessions found for ${repo.root}.`);
  for (const r of refs.slice(0, 20)) {
    console.log(`${toolLabel(r.tool)} ${ago(r.updatedAt).padEnd(9)} ${r.nativeId.slice(0, 14).padEnd(14)}  ${r.title}`);
  }
}

export async function share(opts: ShareOpts): Promise<void> {
  const tool = parseTool(opts.tool);
  const client = opts.dryRun ? await RelayClient.fromConfig().catch(() => null) : await RelayClient.fromConfig();
  const repo = await repoInfo();
  let include = opts.include ? IncludeMode.parse(opts.include) : undefined;
  let people = opts.people ? opts.people.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
  const summary = opts.summaryFile ? Summary.parse(JSON.parse(await readFile(opts.summaryFile, "utf8"))) : undefined;
  const ask_ = interactive() && !opts.yes;

  let ref;
  if (!opts.id && !opts.latest && ask_) {
    const refs = await findSessions(repo.root, tool);
    if (!refs.length) throw new Error(`No Claude Code, OpenCode, Codex or ZCode sessions found for ${repo.root}.`);
    console.log(`Recent sessions in ${repo.repo}:`);
    ref = await choose(
      "Share which session?",
      refs.slice(0, 10).map((r) => ({ label: `${toolLabel(r.tool)} ${ago(r.updatedAt).padEnd(9)} ${r.title}`, value: r })),
    );
  }
  if (!include && ask_) {
    include = await choose<IncludeMode>("Include", [
      { label: "summary + last 30 messages", value: "summary+tail" },
      { label: "summary only", value: "summary" },
      { label: "full transcript", value: "full" },
    ]);
  }
  if (people === undefined && ask_ && !opts.dryRun) {
    const who = await ask("Visible to (Enter = whole team, or names separated by commas): ");
    people = who ? who.split(",").map((s) => s.trim()).filter(Boolean) : [];
  }

  const prepared = await prepareShare(client, {
    tool,
    id: opts.id,
    ref,
    include: include ?? "summary+tail",
    tail: opts.tail ? Number(opts.tail) : undefined,
    summary,
    title: opts.title,
    people,
    continues: opts.continues,
    assign: opts.for,
    pr: opts.pr,
  });
  const { session } = prepared.built;
  const redactNote = describeRedactions(prepared.built.redactions);

  if (opts.dryRun) {
    const file = await writeDryRun(prepared);
    console.log(`${redactNote}\nDry run: nothing was uploaded. Review ${path.relative(process.cwd(), file) || file}`);
    return;
  }
  if (!opts.json) {
    console.log(`\n"${session.title}" · ${toolLabel(prepared.ref.tool).trim()} · ${session.include} · ${session.messages.length} messages · ${session.visibility.team ? "whole team" : `${session.visibility.people.length} people`}`);
    console.log(redactNote);
    if (session.continues) console.log(`Continues ${session.continues}${prepared.continuesAuto ? " (the session you picked up here)" : ""}. Use --continues none to unlink.`);
    if (opts.for) console.log(`For ${opts.for}.`);
    if (session.pr_url) console.log(`PR ${session.pr_url}${opts.pr ? "" : " (this branch's open PR; --pr none to leave it out)"}`);
  }
  if (ask_ && !(await confirm("Share it?"))) return console.log("Cancelled.");

  const { id, continues } = await uploadShare(client!, prepared);
  if (opts.json) {
    return console.log(JSON.stringify({ id, title: session.title, redactions: session.redactions, continues: continues ?? null, pr_url: session.pr_url ?? null }));
  }
  console.log(`Shared as ${id}. Teammates can run: relay pull ${id}`);
}

interface ListOpts {
  all?: boolean;
  repo?: string;
  branch?: string;
  tool?: string;
  author?: string;
  forMe?: boolean;
  file?: string;
  limit?: string;
  json?: boolean;
}

async function printList(query: Record<string, string | number | undefined>, json?: boolean) {
  const client = await RelayClient.fromConfig();
  const { sessions } = await client.list(query);
  if (json) return console.log(JSON.stringify(sessions, null, 2));
  if (!sessions.length) return console.log("No shared sessions found.");
  for (const s of sessions) {
    const tags = [
      s.assignee ? `for ${s.assignee.name}` : "",
      s.pr_url ? `PR #${s.pr_url.split("/").pop()}` : "",
      s.comment_count ? `${s.comment_count} comment${s.comment_count === 1 ? "" : "s"}` : "",
    ]
      .filter(Boolean)
      .join(", ");
    console.log(
      `${s.id}  ${s.author.name.slice(0, 12).padEnd(12)} ${toolLabel(s.tool)} ${ago(s.created_at).padEnd(9)} ${(s.branch ?? "").slice(0, 18).padEnd(18)} ${s.title}${tags ? `  (${tags})` : ""}`,
    );
  }
}

export async function list(opts: ListOpts): Promise<void> {
  let repo = opts.repo;
  // Handoffs for you are worth seeing from any repo.
  if (!repo && !opts.all && !opts.forMe) repo = await repoInfo().then((r) => r.repo).catch(() => undefined);
  await printList(
    { repo, branch: opts.branch, tool: parseTool(opts.tool), author: opts.author, assignee: opts.forMe ? "me" : undefined, file: opts.file, limit: opts.limit },
    opts.json,
  );
}

export async function search(query: string, opts: ListOpts): Promise<void> {
  await printList(
    { q: query, repo: opts.repo, branch: opts.branch, author: opts.author, tool: parseTool(opts.tool), assignee: opts.forMe ? "me" : undefined, file: opts.file, limit: opts.limit },
    opts.json,
  );
}

interface EditOpts {
  title?: string;
  goal?: string;
  addDecision?: string[];
  addDone?: string[];
  addNext?: string[];
  addQuestion?: string[];
  clearNext?: boolean;
  summaryFile?: string;
  for?: string;
  pr?: string;
  team?: boolean;
  people?: string;
}

/** relay edit: change a share after it was made (author or admin). */
export async function edit(id: string, opts: EditOpts): Promise<void> {
  const client = await RelayClient.fromConfig();
  const patch: SessionPatch = {};
  if (opts.title) patch.title = opts.title;
  const touchesSummary = opts.goal || opts.summaryFile || opts.clearNext || opts.addDecision || opts.addDone || opts.addNext || opts.addQuestion;
  if (touchesSummary) {
    const current = opts.summaryFile
      ? Summary.parse(JSON.parse(await readFile(opts.summaryFile, "utf8")))
      : (await client.get(id, "summary")).summary;
    patch.summary = {
      goal: opts.goal ?? current.goal,
      decisions: [...current.decisions, ...(opts.addDecision ?? [])],
      done: [...current.done, ...(opts.addDone ?? [])],
      next: [...(opts.clearNext ? [] : current.next), ...(opts.addNext ?? [])],
      open_questions: [...current.open_questions, ...(opts.addQuestion ?? [])],
    };
  }
  if (opts.for) patch.assignee = opts.for === "none" ? null : await resolvePerson(client, opts.for);
  if (opts.pr) patch.pr_url = opts.pr === "none" ? null : opts.pr;
  if (opts.team) patch.visibility = { team: true, people: [] };
  else if (opts.people) {
    patch.visibility = { team: false, people: await resolvePeople(client, opts.people.split(",").map((p) => p.trim()).filter(Boolean)) };
  }
  if (!Object.keys(patch).length) throw new Error("Nothing to change. See: relay edit --help");
  await client.update(id, patch);
  console.log(`Updated ${id}.`);
}

/** relay pr-comment: post a link to the session on its pull request (needs the GitHub CLI). */
export async function prComment(id: string, opts: { pr?: string }): Promise<void> {
  const client = await RelayClient.fromConfig();
  const s = await client.get(id, "summary");
  const pr = opts.pr ?? s.pr_url;
  if (!pr) throw new Error(`${id} has no PR. Pass --pr <url>, or set one with: relay edit ${id} --pr <url>`);
  if (!s.pr_url) await client.update(id, { pr_url: pr });
  const link = `${client.config.server.replace(/\/$/, "")}/#/s/${s.id}`;
  const next = s.summary.next.length ? `\n\n**Next steps**\n${s.summary.next.map((n) => `- ${n}`).join("\n")}` : "";
  const body = `**Agent session:** [${s.title}](${link}) · shared by ${s.author.name} from Session Relay\n\n${s.summary.goal}${next}\n\nContinue it in your agent with \`/pickup ${s.id}\` or \`relay pull ${s.id}\`.`;
  try {
    await promisify(execFile)("gh", ["pr", "comment", pr, "--body", body], { timeout: 30000 });
  } catch (err) {
    throw new Error(`gh pr comment failed: ${((err as { stderr?: string }).stderr || (err as Error).message).trim()}`);
  }
  console.log(`Commented on ${pr}.`);
}

function mode(opts: { full?: boolean; summaryOnly?: boolean }): DetailMode {
  return opts.full ? "full" : opts.summaryOnly ? "summary" : "tail";
}

export async function show(id: string, opts: { full?: boolean; summaryOnly?: boolean; tail?: string; json?: boolean }): Promise<void> {
  const client = await RelayClient.fromConfig();
  const s = await client.get(id, mode(opts), { tail: opts.tail ? Number(opts.tail) : undefined });
  console.log(opts.json ? JSON.stringify(s, null, 2) : renderHandoff(s));
}

/** Writes the handoff file into .relay/ in the current repo (or the current folder). */
export async function pull(id: string, opts: { full?: boolean; summaryOnly?: boolean; out?: string }): Promise<void> {
  const client = await RelayClient.fromConfig();
  let s = await client.get(id, mode(opts));
  if (opts.full) {
    // Fetch every page so the file has the whole transcript.
    const messages = [...s.messages];
    while (messages.length < s.message_total) {
      const page = await client.get(id, "full", { offset: messages.length, limit: 1000 });
      if (!page.messages.length) break;
      messages.push(...page.messages);
    }
    s = { ...s, messages, message_offset: 0 };
  }
  const repoRoot = await repoInfo().then((r) => r.root).catch(() => null);
  const base = repoRoot ?? process.cwd();
  const file = opts.out ?? path.join(await relayDir(base), `handoff-${s.id}.md`);
  // Your next share in this repo will link back to this session.
  if (repoRoot) await recordPickup(repoRoot, s.id);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, renderHandoff(s));
  const rel = path.relative(process.cwd(), file) || file;
  console.log(`Wrote ${rel}\nTell your agent: "Read ${rel} and continue from where it stopped."`);
}

/** relay comment <id> <text>: leave a note; with no text, list the comments. */
export async function comment(id: string, words: string[]): Promise<void> {
  const client = await RelayClient.fromConfig();
  const body = words.join(" ").trim();
  if (body) {
    await client.comment(id, body);
    return console.log(`Commented on ${id}.`);
  }
  const { comments } = await client.comments(id);
  if (!comments.length) return console.log(`No comments on ${id}. Add one: relay comment ${id} "your note"`);
  for (const c of comments) console.log(`${c.author.name} · ${ago(c.created_at)}\n  ${c.body.replace(/\n/g, "\n  ")}\n`);
}

export async function remove(id: string, opts: { yes?: boolean }): Promise<void> {
  const client = await RelayClient.fromConfig();
  if (interactive() && !opts.yes && !(await confirm(`Delete ${id} for everyone? Copies already pulled are not recalled.`, false))) {
    return console.log("Cancelled.");
  }
  await client.remove(id);
  console.log(`Deleted ${id}.`);
}

export async function members(): Promise<void> {
  const client = await RelayClient.fromConfig();
  const { members } = await client.members();
  for (const m of members) console.log(`${m.name.padEnd(20)} ${m.email.padEnd(30)} ${m.role}`);
}

export async function invite(email: string | undefined, opts: { name?: string; role?: string; link?: boolean; days?: string }): Promise<void> {
  const client = await RelayClient.fromConfig();
  if (opts.link || !email) {
    const r = await client.inviteLink(opts.role ?? "member", Number(opts.days ?? 7));
    const until = new Date(r.expires_at).toLocaleDateString(undefined, { day: "numeric", month: "short" });
    console.log(`Invite link (${r.role}, works once, expires ${until}). Send it to one person:\n  ${r.url}`);
    return;
  }
  if (!opts.name) throw new Error("Add --name, or use --link to create an invite link instead.");
  const { user, token } = await client.invite(email, opts.name, opts.role ?? "member");
  console.log(`Added ${user.name} <${user.email}> as ${user.role}.`);
  console.log(`\nSend them this privately (shown once):\n  relay login --server ${client.config.server} --token ${token}`);
}
