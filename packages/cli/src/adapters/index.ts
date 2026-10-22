import type { SourceTool } from "@session-relay/shared";
import { claudeAdapter } from "./claude.js";
import { codexAdapter } from "./codex.js";
import { openCodeAdapter } from "./opencode.js";
import type { Adapter, SessionRef } from "./types.js";

export const ADAPTERS: Record<SourceTool, Adapter> = {
  "claude-code": claudeAdapter,
  opencode: openCodeAdapter,
  codex: codexAdapter,
};

/** Recent sessions for this repo across all (or one) tools, newest first. */
export async function findSessions(repoRoot: string, tool?: SourceTool): Promise<SessionRef[]> {
  const adapters = tool ? [ADAPTERS[tool]] : Object.values(ADAPTERS);
  const lists = await Promise.all(adapters.map((a) => a.list(repoRoot).catch(() => [])));
  return lists.flat().sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

export type { Adapter, LocalSession, SessionRef } from "./types.js";
