import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { isInside, samePathVariants } from "../git.js";
import { parseOpenCodeExport } from "./opencode.js";
import type { Adapter, LocalSession, SessionRef } from "./types.js";

const run = promisify(execFile);

/** ZCode (CLI and desktop app) keeps every session in one SQLite file. */
export const zcodeDb = () => process.env.ZCODE_DB ?? path.join(homedir(), ".zcode", "cli", "db", "db.sqlite");

type Row = Record<string, any>;
type Query = (sql: string, params: (string | number)[]) => Promise<Row[]>;

/**
 * Read-only queries against the ZCode database. Uses node:sqlite (Node 22.5+) and falls back to
 * the sqlite3 command (built into macOS). Returns null when neither is available.
 */
async function opener(file: string): Promise<{ query: Query; close: () => void } | null> {
  try {
    const emit = process.emitWarning;
    process.emitWarning = (() => undefined) as typeof process.emitWarning; // "SQLite is an experimental feature"
    const { DatabaseSync } = await import("node:sqlite").finally(() => (process.emitWarning = emit));
    const db = new DatabaseSync(file, { readOnly: true });
    return { query: async (sql, params) => db.prepare(sql).all(...params) as Row[], close: () => db.close() };
  } catch {
    // Older Node: fall through to the sqlite3 command.
  }
  try {
    await run("sqlite3", ["--version"]);
  } catch {
    return null;
  }
  const query: Query = async (sql, params) => {
    // sqlite3 has no bind parameters on the command line; values here are ids we read from the same database.
    let i = 0;
    const text = sql.replace(/\?/g, () => `'${String(params[i++]).replace(/'/g, "''")}'`);
    const { stdout } = await run("sqlite3", ["-readonly", "-json", file, text], { maxBuffer: 256 * 1024 * 1024 });
    return stdout.trim() ? JSON.parse(stdout) : [];
  };
  return { query, close: () => undefined };
}

/** Builds the same shape as `opencode export`: ZCode stores messages and parts in OpenCode's format. */
export function toExport(session: Row, messages: Row[], parts: Row[]): any {
  const byMessage = new Map<string, any[]>();
  for (const p of parts) {
    const list = byMessage.get(p.message_id) ?? [];
    list.push({ ...JSON.parse(p.data), id: p.id });
    byMessage.set(p.message_id, list);
  }
  return {
    info: {
      id: session.id,
      directory: session.directory,
      title: session.title,
      version: session.version,
      time: { created: session.time_created, updated: session.time_updated },
    },
    messages: messages.map((m) => ({ info: { ...JSON.parse(m.data), id: m.id }, parts: byMessage.get(m.id) ?? [] })),
  };
}

export function parseZCodeExport(data: any): LocalSession {
  return { ...parseOpenCodeExport(data), tool: "zcode" };
}

export const zcodeAdapter: Adapter = {
  tool: "zcode",

  async list(repoRoot) {
    const file = zcodeDb();
    if (!existsSync(file)) return [];
    const db = await opener(file);
    if (!db) return [];
    try {
      const rows = await db.query(
        `SELECT id, title, directory, time_created, time_updated FROM session
         WHERE parent_id IS NULL AND time_archived IS NULL AND time_deleted IS NULL
         ORDER BY time_updated DESC LIMIT 200`,
        [],
      );
      const roots = samePathVariants(repoRoot);
      return rows
        .filter((r) => typeof r.directory === "string" && roots.some((root) => isInside(r.directory, root)))
        .slice(0, 50)
        .map((r) => ({
          tool: "zcode" as const,
          nativeId: r.id,
          title: r.title || "Untitled session",
          cwd: r.directory,
          updatedAt: new Date(Number(r.time_updated ?? r.time_created ?? 0)),
        }));
    } catch {
      return []; // Unknown schema version.
    } finally {
      db.close();
    }
  },

  async load(ref: SessionRef) {
    const db = await opener(zcodeDb());
    if (!db) throw new Error("Reading ZCode sessions needs Node 22.5+ or the sqlite3 command.");
    try {
      const [session] = await db.query(`SELECT * FROM session WHERE id = ?`, [ref.nativeId]);
      if (!session) throw new Error(`ZCode session ${ref.nativeId} not found`);
      const messages = await db.query(
        `SELECT id, data FROM message WHERE session_id = ? ORDER BY sequence IS NULL, sequence, time_created, id`,
        [ref.nativeId],
      );
      const parts = await db.query(
        `SELECT id, message_id, data FROM part WHERE session_id = ? ORDER BY sequence IS NULL, sequence, time_created, id`,
        [ref.nativeId],
      );
      return parseZCodeExport(toExport(session, messages, parts));
    } finally {
      db.close();
    }
  },
};
