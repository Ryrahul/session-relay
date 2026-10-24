import type { ShareTemplate } from "./api.js";
import type { Summary } from "./session.js";

/** The template for a repo: an exact match, else the longest "prefix*" ("github.com/acme/*"), else "*". */
export function matchTemplate(templates: ShareTemplate[], repo: string): ShareTemplate | null {
  const r = repo.toLowerCase();
  const exact = templates.find((t) => t.repo.toLowerCase() === r);
  if (exact) return exact;
  const prefixes = templates
    .filter((t) => t.repo !== "*" && t.repo.endsWith("*") && r.startsWith(t.repo.slice(0, -1).toLowerCase()))
    .sort((a, b) => b.repo.length - a.repo.length);
  return prefixes[0] ?? templates.find((t) => t.repo === "*") ?? null;
}

const norm = (s: string) => s.trim().toLowerCase();

/** Required template sections the summary leaves out or empty (titles compared case-insensitively). */
export function missingSections(template: ShareTemplate | null, summary: Pick<Summary, "sections">): string[] {
  if (!template) return [];
  const filled = new Set((summary.sections ?? []).filter((s) => s.items.some((i) => i.trim())).map((s) => norm(s.title)));
  return template.sections.filter((s) => s.required && !filled.has(norm(s.title))).map((s) => s.title);
}

/** The template as instructions an agent (or a person) can follow. */
export function describeTemplate(t: ShareTemplate): string {
  const lines = [`Handoff template for ${t.repo}:`];
  if (t.instructions.trim()) lines.push(t.instructions.trim());
  if (t.sections.length) {
    lines.push("Add these sections (pass them as `sections`, each with a title and a list of items):");
    for (const s of t.sections) lines.push(`- ${s.title}${s.required ? " (required)" : ""}${s.hint ? `: ${s.hint}` : ""}`);
  }
  return lines.join("\n");
}
