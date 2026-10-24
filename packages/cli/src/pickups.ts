import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { configPath } from "./config.js";

/** How long a pickup counts as "what you're continuing" for the next share in that repo. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type Pickups = Record<string, { id: string; at: string }>;

/** One pickups file per account config, so two logins on one laptop don't mix. */
function file(): string {
  const cfg = configPath();
  return path.join(path.dirname(cfg), `${path.basename(cfg, ".json")}.pickups.json`);
}

async function load(): Promise<Pickups> {
  try {
    return JSON.parse(await readFile(file(), "utf8")) as Pickups;
  } catch {
    return {};
  }
}

/** Remember that this repo's work continues the shared session `id` (after /pickup or relay pull). */
export async function recordPickup(repoRoot: string, id: string, now = new Date()): Promise<void> {
  const all = await load();
  all[repoRoot] = { id, at: now.toISOString() };
  await mkdir(path.dirname(file()), { recursive: true });
  await writeFile(file(), JSON.stringify(all, null, 2) + "\n", { mode: 0o600 });
}

/** The session most recently picked up in this repo, if it was within the last 7 days. */
export async function lastPickup(repoRoot: string, now = new Date()): Promise<string | null> {
  const p = (await load())[repoRoot];
  if (!p) return null;
  return now.getTime() - new Date(p.at).getTime() <= MAX_AGE_MS ? p.id : null;
}

export async function forgetPickup(repoRoot: string): Promise<void> {
  const all = await load();
  if (!(repoRoot in all)) return;
  delete all[repoRoot];
  await writeFile(file(), JSON.stringify(all, null, 2) + "\n", { mode: 0o600 });
}

/**
 * What a new share should continue: an explicit id, "none" for nothing, or (by default)
 * the last pickup in this repo.
 */
export async function resolveContinues(repoRoot: string, explicit?: string): Promise<{ id?: string; auto: boolean }> {
  if (explicit === "none") return { auto: false };
  if (explicit) return { id: explicit, auto: false };
  const id = await lastPickup(repoRoot);
  return id ? { id, auto: true } : { auto: false };
}
