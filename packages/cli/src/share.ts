import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { IncludeMode, SourceTool, Summary } from "@session-relay/shared";
import { ADAPTERS, findSessions, type SessionRef } from "./adapters/index.js";
import { buildShare, type BuiltShare } from "./build.js";
import { resolvePeople, type RelayClient } from "./client.js";
import { repoInfo, type RepoInfo } from "./git.js";

export interface ShareInput {
  cwd?: string;
  tool?: SourceTool;
  /** Native session id; otherwise the newest session (optionally for `tool`). */
  id?: string;
  ref?: SessionRef;
  include: IncludeMode;
  tail?: number;
  summary?: Summary;
  title?: string;
  /** Empty means the whole team. */
  people?: string[];
}

export interface PreparedShare {
  repo: RepoInfo;
  ref: SessionRef;
  built: BuiltShare;
}

export async function pickSession(repo: RepoInfo, tool?: SourceTool, id?: string): Promise<SessionRef> {
  const refs = await findSessions(repo.root, tool);
  if (!refs.length) {
    throw new Error(`No ${tool ?? "Claude Code, OpenCode or Codex"} sessions found for ${repo.root}.`);
  }
  if (!id) return refs[0]!;
  const hit = refs.find((r) => r.nativeId === id || r.nativeId.startsWith(id));
  if (!hit) throw new Error(`No session ${id} in this repo. Run \`relay sessions\` to see local sessions.`);
  return hit;
}

/** Reads, normalises and redacts a local session. No network calls except org settings and people lookup. */
export async function prepareShare(client: RelayClient | null, input: ShareInput): Promise<PreparedShare> {
  const repo = await repoInfo(input.cwd);
  const ref = input.ref ?? (await pickSession(repo, input.tool, input.id));
  const local = await ADAPTERS[ref.tool].load(ref);
  if (!local.messages.length) throw new Error(`Session ${ref.nativeId} has no messages yet.`);

  const me = client ? await client.me() : null;
  const people = client && input.people?.length ? await resolvePeople(client, input.people) : [];
  const built = buildShare(local, repo, {
    include: input.include,
    tail: input.tail,
    summary: input.summary,
    title: input.title,
    visibility: { team: people.length === 0, people },
    redactionPatterns: me?.settings.redaction_patterns,
  });
  return { repo, ref, built };
}

/** `.relay/` holds handoffs and dry runs; it ignores itself so nothing in it gets committed. */
export async function relayDir(root: string): Promise<string> {
  const dir = path.join(root, ".relay");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, ".gitignore"), "*\n");
  return dir;
}

/** Dry runs write what would be uploaded, so it can be reviewed before sharing. */
export async function writeDryRun(prepared: PreparedShare): Promise<string> {
  const dir = await relayDir(prepared.repo.root);
  const file = path.join(dir, `dry-run-${prepared.ref.tool}-${prepared.ref.nativeId.slice(0, 12)}.json`);
  await writeFile(file, JSON.stringify({ session: prepared.built.session, transcript: prepared.built.transcript }, null, 2) + "\n");
  return file;
}

export function describeRedactions(counts: Record<string, number>): string {
  const parts = Object.entries(counts).map(([k, n]) => `${n} ${k}`);
  return parts.length ? `Redacted ${parts.join(", ")}.` : "No secrets found.";
}
