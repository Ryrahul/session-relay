import { mkdir, open as openFile, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SourceTool } from "@session-relay/shared";
import { configPath } from "./config.js";
import { isInside, samePathVariants } from "./git.js";

/**
 * Live sessions this machine has open, so hooks can find theirs without asking the server.
 * When no entry matches, hooks exit at once: nothing is sent while you're not live.
 */
export interface LocalLive {
  id: string;
  /** Repo root it was started in. */
  root: string;
  repo: string;
  tool?: SourceTool;
  /** The agent session it belongs to. Set by the first hook that runs in that repo after start. */
  native?: string;
  started: string;
  /** Last time a hook talked to the server, to keep tool hooks from polling on every call. */
  polled?: string;
  /** Last time a stop hook made the agent continue, so it can't loop. */
  continued?: string;
  /** Last time the user sent a prompt: an idle waiter started before it stops. */
  prompted?: string;
  /** The idle waiter that owns this live session now; older ones stop. */
  waiter?: string;
}

/** One file per account config, like pickups. */
export function liveFile(): string {
  const cfg = configPath();
  return path.join(path.dirname(cfg), `${path.basename(cfg, ".json")}.live.json`);
}

export async function loadLive(): Promise<LocalLive[]> {
  try {
    const data = JSON.parse(await readFile(liveFile(), "utf8"));
    return Array.isArray(data?.sessions) ? data.sessions : [];
  } catch {
    return [];
  }
}

export async function saveLive(sessions: LocalLive[]): Promise<void> {
  const file = liveFile();
  await mkdir(path.dirname(file), { recursive: true });
  // Write then rename, so two hooks running at once never leave half a file.
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify({ sessions }, null, 2) + "\n", { mode: 0o600 });
  await rename(tmp, file);
}

/** Waits this long for another hook's change to the live file, then goes ahead without the lock. */
const LOCK_WAIT_MS = 2_000;
/** A lock older than this was left by a hook that died mid-change. */
const LOCK_STALE_MS = 10_000;

/**
 * Runs a read-modify-write of the live file while holding a lock file, so two hooks running at
 * once (Claude Code starts both Stop hooks together) can't overwrite each other's change.
 */
async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const lock = `${liveFile()}.lock`;
  await mkdir(path.dirname(lock), { recursive: true });
  const deadline = Date.now() + LOCK_WAIT_MS;
  let held = false;
  while (!held) {
    try {
      await (await openFile(lock, "wx")).close();
      held = true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") break;
      const age = await stat(lock).then((s) => Date.now() - s.mtimeMs, () => Infinity);
      if (age > LOCK_STALE_MS) await rm(lock, { force: true });
      else if (Date.now() > deadline) break;
      else await new Promise((r) => setTimeout(r, 15));
    }
  }
  try {
    return await fn();
  } finally {
    if (held) await rm(lock, { force: true });
  }
}

export async function addLive(entry: LocalLive): Promise<void> {
  await withLock(async () => saveLive([...(await loadLive()).filter((l) => l.id !== entry.id), entry]));
}

export async function updateLive(id: string, patch: Partial<LocalLive>): Promise<void> {
  await withLock(async () => {
    const all = await loadLive();
    const i = all.findIndex((l) => l.id === id);
    if (i === -1) return;
    all[i] = { ...all[i]!, ...patch };
    await saveLive(all);
  });
}

export async function dropLive(id: string): Promise<void> {
  await withLock(async () => {
    const all = await loadLive();
    if (all.some((l) => l.id === id)) await saveLive(all.filter((l) => l.id !== id));
  });
}

const inRoot = (cwd: string, root: string) => samePathVariants(cwd).some((c) => isInside(c, root));

/**
 * The live session an agent hook belongs to: the one bound to this agent session, or else an
 * unbound one started in this repo, which this agent session then claims.
 */
export async function liveForHook(native: string | undefined, cwd: string, tool: SourceTool): Promise<LocalLive | null> {
  const all = await loadLive();
  if (native) {
    const bound = all.find((l) => l.native === native);
    if (bound) return bound;
  }
  const open = all
    .filter((l) => !l.native && inRoot(cwd, l.root) && (!l.tool || l.tool === tool))
    .sort((a, b) => b.started.localeCompare(a.started))[0];
  if (!open) return null;
  if (native) {
    open.native = native;
    open.tool ??= tool;
    await withLock(async () => {
      const now = await loadLive();
      const cur = now.find((l) => l.id === open.id);
      if (!cur || cur.native) return;
      cur.native = native;
      cur.tool ??= tool;
      await saveLive(now);
    });
  }
  return open;
}

/** The live session for commands and MCP tools run in `cwd` (newest first; the caller's agent preferred). */
export async function liveForCwd(cwd: string, tool?: SourceTool): Promise<LocalLive | null> {
  const here = (await loadLive()).filter((l) => inRoot(cwd, l.root)).sort((a, b) => b.started.localeCompare(a.started));
  return here.find((l) => tool && l.tool === tool) ?? here[0] ?? null;
}

/** A path the agent edited, relative to the repo root with forward slashes; null if outside the repo. */
export async function repoPath(file: string, root: string): Promise<string | null> {
  if (!file) return null;
  let abs = path.resolve(root, file);
  // The file may not exist yet (a new file); resolve its folder instead, for /tmp vs /private/tmp.
  abs = await realpath(path.dirname(abs)).then((d) => path.join(d, path.basename(abs)), () => abs);
  const realRoot = await realpath(root).catch(() => root);
  const rel = path.relative(realRoot, abs);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join("/");
}
