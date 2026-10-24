import type { SessionDetail } from "@session-relay/shared";

const TOOL_NAMES = { "claude-code": "Claude Code", codex: "Codex", opencode: "OpenCode", zcode: "ZCode" } as const;

function list(title: string, items: string[]): string {
  return items.length ? `\n## ${title}\n${items.map((i) => `- ${i}`).join("\n")}\n` : "";
}

/** Markdown an agent (or a person) can read to pick up where the session stopped. */
export function renderHandoff(s: SessionDetail): string {
  const when = new Date(s.created_at).toISOString().slice(0, 16).replace("T", " ");
  const head = [
    `# ${s.title}`,
    "",
    `Shared by **${s.author.name}** from ${TOOL_NAMES[s.source.tool]} · ${when} UTC · \`${s.id}\``,
    `Repo \`${s.repo}\`${s.branch ? ` · branch \`${s.branch}\`` : ""}${s.commit ? ` · commit \`${s.commit}\`` : ""}`,
    ...(s.chain?.length
      ? [`Continues ${s.chain.map((c) => `"${c.title}" (${c.author.name}, \`${c.id}\`)`).join(" → ")}`]
      : []),
    ...(s.assigned_to ? [`For **${s.assigned_to.name}**`] : []),
    ...(s.pr_url ? [`Pull request: ${s.pr_url}`] : []),
    ...(s.updated_at ? [`Edited ${new Date(s.updated_at).toISOString().slice(0, 16).replace("T", " ")} UTC`] : []),
    ...(s.continued_by?.length
      ? [`Continued by ${s.continued_by.map((c) => `"${c.title}" (${c.author.name}, \`${c.id}\`)`).join(", ")}`]
      : []),
    "",
    "## Goal",
    s.summary.goal || "(not stated)",
  ].join("\n");

  const body =
    list("Decisions", s.summary.decisions) +
    list("Done", s.summary.done) +
    list("Next steps", s.summary.next) +
    list("Open questions", s.summary.open_questions) +
    list("Files touched", s.files_touched.map((f) => `\`${f}\``));

  // Teammates' notes come before the conversation: they are often the latest word on the work.
  const notes = s.comments?.length
    ? `\n## Comments from the team\n${s.comments
        .map((c) => `- **${c.author.name}** (${new Date(c.created_at).toISOString().slice(0, 16).replace("T", " ")} UTC): ${c.body.replace(/\n/g, "\n  ")}`)
        .join("\n")}\n`
    : "";

  let convo = "";
  if (s.messages.length) {
    const from = s.message_offset + 1;
    const to = s.message_offset + s.messages.length;
    convo =
      `\n## Conversation (messages ${from}–${to} of ${s.message_total})\n` +
      s.messages.map((m) => (m.role === "tool" ? `> _tool:_ ${m.text}` : `**${m.role}:** ${m.text}`)).join("\n\n") +
      "\n";
  }
  return `${head}\n${body}${notes}${convo}`;
}
