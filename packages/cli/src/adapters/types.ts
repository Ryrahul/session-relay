import type { Message, SourceTool } from "@session-relay/shared";

/** A session found on this machine, before it is loaded. */
export interface SessionRef {
  tool: SourceTool;
  nativeId: string;
  title: string;
  cwd: string;
  updatedAt: Date;
  /** Transcript file, for tools that keep one per session. */
  file?: string;
}

/** A session read from a tool and converted to the common message shape. */
export interface LocalSession {
  tool: SourceTool;
  version?: string;
  nativeId: string;
  cwd: string;
  branch?: string;
  title: string;
  startedAt?: string;
  messages: Message[];
  /** Paths as the tool recorded them (usually absolute). */
  filesTouched: string[];
}

export interface Adapter {
  tool: SourceTool;
  /** Sessions whose working directory is inside `repoRoot`, newest first. */
  list(repoRoot: string): Promise<SessionRef[]>;
  load(ref: SessionRef): Promise<LocalSession>;
}
