/**
 * Removes secrets from text before it leaves this machine.
 * Patterns err on the side of redacting; a false positive costs a word, a miss leaks a key.
 */
interface Rule {
  kind: string;
  re: RegExp;
  /** Builds the replacement from the match groups; defaults to the whole match. */
  replace?: (m: RegExpExecArray, tag: string) => string;
}

const tag = (kind: string) => `[REDACTED:${kind}]`;

const RULES: Rule[] = [
  { kind: "private-key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { kind: "aws-key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: "github-token", re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/g },
  { kind: "anthropic-key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { kind: "openai-key", re: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/g },
  { kind: "stripe-key", re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  { kind: "slack-token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { kind: "google-key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: "relay-token", re: /\bsrk_[A-Za-z0-9_-]{20,}/g },
  { kind: "jwt", re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  {
    kind: "bearer",
    re: /\b(Bearer|Basic)\s+([A-Za-z0-9._~+/=-]{16,})/g,
    replace: (m, t) => `${m[1]} ${t}`,
  },
  {
    kind: "url-password",
    re: /\b([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)([^\s@/]+)@/gi,
    replace: (m, t) => `${m[1]}${t}@`,
  },
  {
    // Env style: STRIPE_SECRET_KEY=..., quoted or not. Upper case only, so code like `token = getToken()` is left alone.
    kind: "secret-assignment",
    re: /\b([A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|PRIVATE_KEY|ACCESS_KEY)[A-Z0-9_]*)(\s*[=:]\s*)(["']?)([^\s"'`,;]{6,})\3/g,
    replace: (m, t) => `${m[1]}${m[2]}${m[3]}${t}${m[3]}`,
  },
  {
    // Any case, but only quoted literals: "apiKey": "...", password = '...'.
    kind: "secret-assignment",
    re: /\b([A-Za-z0-9_-]*(?:secret|token|password|passwd|api_?key|private_?key|access_?key)[A-Za-z0-9_-]*)(["']?\s*[=:]\s*)(["'])([^"'\s]{6,})\3/gi,
    replace: (m, t) => `${m[1]}${m[2]}${m[3]}${t}${m[3]}`,
  },
];

export interface Redactor {
  (text: string): string;
  /** Count per kind, across every call so far. */
  counts: Record<string, number>;
  total(): number;
}

/** `extra` are org-defined regex sources (from org settings). */
export function createRedactor(extra: string[] = []): Redactor {
  const rules: Rule[] = [...RULES];
  for (const src of extra) {
    try {
      rules.push({ kind: "org-pattern", re: new RegExp(src, "g") });
    } catch {
      // An invalid org pattern must not block sharing; the built-in rules still apply.
    }
  }
  const counts: Record<string, number> = {};
  const redact = ((text: string) => {
    let out = text;
    for (const rule of rules) {
      rule.re.lastIndex = 0;
      out = out.replace(rule.re, (...args) => {
        const groups = args.slice(0, -2) as string[];
        if (groups[0]!.includes("[REDACTED:")) return groups[0]!;
        counts[rule.kind] = (counts[rule.kind] ?? 0) + 1;
        const m = Object.assign(groups, { index: 0, input: out }) as unknown as RegExpExecArray;
        return rule.replace ? rule.replace(m, tag(rule.kind)) : tag(rule.kind);
      });
    }
    return out;
  }) as Redactor;
  redact.counts = counts;
  redact.total = () => Object.values(counts).reduce((a, b) => a + b, 0);
  return redact;
}
