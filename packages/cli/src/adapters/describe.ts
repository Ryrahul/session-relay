import path from "node:path";

const MAX_CMD = 200;
const MAX_OUT = 160;

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length ? v : undefined;
}

function rel(p: string, root: string): string {
  if (!path.isAbsolute(p)) return p;
  const r = path.relative(root, p);
  return r && !r.startsWith("..") ? r : p;
}

function clip(s: string, n: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? one.slice(0, n - 1) + "…" : one;
}

/** Files named in an apply_patch body ("*** Update File: path"). */
export function patchFiles(patch: string): string[] {
  return [...patch.matchAll(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm)].map((m) => m[1]!.trim());
}

export interface ToolDescription {
  text: string;
  files: string[];
  /** Whether the outcome line should carry the command output. */
  showOutput: boolean;
}

/**
 * Turns one tool call into a short line any agent can read, e.g.
 * "edited src/a.ts" or "ran `npm test`". Tool names differ per agent, so match loosely.
 */
/** Agent plumbing that says nothing about the work. */
const INTERNAL = new Set(["toolsearch", "enterplanmode", "exitplanmode", "askuserquestion", "report_intent", "save_memory", "think"]);

/** Other agents' names for the same tools (Gemini CLI, Copilot CLI, Cursor). */
const ALIASES: Record<string, string> = {
  read_file: "read",
  read_many_files: "read",
  write_file: "write",
  replace: "edit",
  edit_file: "edit",
  search_replace: "edit",
  strreplace: "edit",
  str_replace_editor: "edit",
  run_shell_command: "bash",
  run_terminal_cmd: "bash",
  powershell: "bash",
  search_file_content: "grep",
  grep_search: "grep",
  codebase_search: "search",
  file_search: "glob",
  list_directory: "ls",
  list_dir: "ls",
  google_web_search: "web_search",
  write_todos: "todowrite",
  todo_write: "todowrite",
  update_todo: "todowrite",
};

export function isInternalTool(name: string): boolean {
  return INTERNAL.has(name.toLowerCase());
}

export function describeToolCall(name: string, input: Record<string, unknown>, root: string): ToolDescription {
  const lower = name.toLowerCase();
  const n = ALIASES[lower] ?? lower;
  const file =
    str(input.file_path) ?? str(input.filePath) ?? str(input.path) ?? str(input.notebook_path) ?? str(input.absolute_path) ?? str(input.target_file);
  const f = file ? rel(file, root) : undefined;

  if (n === "read" || n === "view") return { text: `read ${f ?? "a file"}`, files: [], showOutput: false };
  if (lower === "delete_file") return { text: `deleted ${f ?? "a file"}`, files: file ? [file] : [], showOutput: false };
  if (n === "write" || n === "create") return { text: `wrote ${f ?? "a file"}`, files: file ? [file] : [], showOutput: false };
  if (n === "edit" || n === "multiedit" || n === "str_replace" || n === "notebookedit") {
    return { text: `edited ${f ?? "a file"}`, files: file ? [file] : [], showOutput: false };
  }
  if (n === "apply_patch" || n === "patch") {
    const body = str(input.patchText) ?? str(input.patch) ?? str(input.input) ?? "";
    const files = patchFiles(body);
    return { text: `patched ${files.map((p) => rel(p, root)).join(", ") || "files"}`, files, showOutput: false };
  }
  if (n === "bash" || n === "shell" || n === "exec_command" || n === "local_shell" || n === "run_command") {
    const raw = input.command ?? input.cmd;
    let cmd = Array.isArray(raw) ? raw.map(String) : str(raw) ?? "";
    // Codex wraps commands as ["bash", "-lc", "<script>"].
    if (Array.isArray(cmd)) cmd = cmd.length >= 3 && /sh$/.test(cmd[0]!) && cmd[1]!.startsWith("-") ? cmd.slice(2).join(" ") : cmd.join(" ");
    return { text: `ran \`${clip(cmd, MAX_CMD)}\``, files: [], showOutput: true };
  }
  if (n === "glob" || n === "grep" || n === "search" || n === "list" || n === "ls") {
    const what = str(input.pattern) ?? str(input.query) ?? f ?? "";
    return { text: `searched ${clip(what, 80)}`.trim(), files: [], showOutput: false };
  }
  if (n === "webfetch" || n === "web_fetch" || n === "websearch" || n === "web_search") {
    return { text: `${n.includes("search") ? "searched the web for" : "fetched"} ${clip(str(input.url) ?? str(input.query) ?? "", 120)}`, files: [], showOutput: false };
  }
  if (n === "todowrite" || n === "update_plan") return { text: "updated the task list", files: [], showOutput: false };
  if (n === "task" || n === "agent") return { text: `delegated: ${clip(str(input.description) ?? str(input.prompt) ?? "a subtask", 120)}`, files: [], showOutput: false };
  return { text: `used ${name}`, files: [], showOutput: false };
}

/** Adds a short output or failure note to a tool line. */
export function withOutcome(d: ToolDescription, output: unknown, failed = false): string {
  if (failed) return `${d.text} (failed${typeof output === "string" && output ? `: ${clip(output, MAX_OUT)}` : ""})`;
  if (!d.showOutput || typeof output !== "string" || !output.trim()) return d.text;
  return `${d.text} → ${clip(output, MAX_OUT)}`;
}
