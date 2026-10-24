import { createInterface } from "node:readline/promises";

const TOOL_LABEL: Record<string, string> = { "claude-code": "claude", opencode: "opencode", codex: "codex", zcode: "zcode", gemini: "gemini", copilot: "copilot", cursor: "cursor" };

export function toolLabel(tool: string): string {
  return (TOOL_LABEL[tool] ?? tool).padEnd(8);
}

export function ago(date: Date | string): string {
  const s = Math.max(0, (Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function interactive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

export async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

export async function choose<T>(question: string, options: { label: string; value: T }[], defaultIndex = 0): Promise<T> {
  options.forEach((o, i) => console.log(`  ${String(i + 1).padStart(2)}. ${o.label}${i === defaultIndex ? "  (default)" : ""}`));
  for (;;) {
    const raw = await ask(`${question} [${defaultIndex + 1}]: `);
    if (!raw) return options[defaultIndex]!.value;
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 1 && n <= options.length) return options[n - 1]!.value;
    console.log(`Enter a number from 1 to ${options.length}.`);
  }
}

export async function confirm(question: string, defaultYes = true): Promise<boolean> {
  const raw = (await ask(`${question} ${defaultYes ? "[Y/n]" : "[y/N]"} `)).toLowerCase();
  return raw ? raw.startsWith("y") : defaultYes;
}
