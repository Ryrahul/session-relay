import { Fragment, type ReactNode } from "react";

/** Inline `code` and **bold**. Everything else is plain text (React escapes it). */
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /`([^`\n]+)`|\*\*([^*\n]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(m[1] !== undefined ? <code key={`${key}-${i++}`}>{m[1]}</code> : <strong key={`${key}-${i++}`}>{m[2]}</strong>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Renders agent/user message text: fenced code blocks, inline code and bold. */
export function RichText({ text }: { text: string }) {
  const parts = text.split(/```[\w-]*\n?/);
  return (
    <div className="rich">
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <pre key={i} className="code-block">
            <code>{part.replace(/\n$/, "")}</code>
          </pre>
        ) : (
          <Fragment key={i}>
            {part
              .split(/\n{2,}/)
              .filter((p) => p.trim())
              .map((p, j) => (
                <p key={j}>{inline(p, `${i}-${j}`)}</p>
              ))}
          </Fragment>
        ),
      )}
    </div>
  );
}
