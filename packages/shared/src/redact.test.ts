import { describe, expect, it } from "vitest";
import { createRedactor } from "./redact.js";

describe("redactor", () => {
  const cases: [string, string, string][] = [
    ["aws", "key AKIAIOSFODNN7EXAMPLE here", "key [REDACTED:aws-key] here"],
    ["github", "token ghp_" + "a".repeat(36), "token [REDACTED:github-token]"],
    ["anthropic", "sk-ant-api03-" + "x".repeat(30), "[REDACTED:anthropic-key]"],
    ["openai", "OPENAI sk-proj-" + "y".repeat(30), "OPENAI [REDACTED:openai-key]"],
    ["stripe", "sk_live_" + "z".repeat(24), "[REDACTED:stripe-key]"],
    ["bearer", "Authorization: Bearer abcdefghijklmnop1234", "Authorization: Bearer [REDACTED:bearer]"],
    ["db url", "postgres://relay:hunter2pass@db:5432/x", "postgres://relay:[REDACTED:url-password]@db:5432/x"],
    ["env", "STRIPE_SECRET_KEY=whsec_abc123def", "STRIPE_SECRET_KEY=[REDACTED:secret-assignment]"],
    ["json", '"apiKey": "abcdef123456"', '"apiKey": "[REDACTED:secret-assignment]"'],
    ["relay", "srk_" + "q".repeat(43), "[REDACTED:relay-token]"],
  ];
  for (const [name, input, expected] of cases) {
    it(`redacts ${name}`, () => expect(createRedactor()(input)).toBe(expected));
  }

  it("redacts private keys", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIE\nabc\n-----END RSA PRIVATE KEY-----";
    expect(createRedactor()(`x ${pem} y`)).toBe("x [REDACTED:private-key] y");
  });

  it("leaves normal code alone", () => {
    const code = "const token = getToken();\nexport function add(a, b) { return a + b; }\nrisk-assessment task-runner";
    expect(createRedactor()(code)).toBe(code);
  });

  it("counts and applies org patterns", () => {
    const r = createRedactor(["ACME-[0-9]{6}", "(bad regex"]);
    expect(r("ticket ACME-123456 and AKIAIOSFODNN7EXAMPLE")).toBe("ticket [REDACTED:org-pattern] and [REDACTED:aws-key]");
    expect(r.total()).toBe(2);
    expect(r.counts).toEqual({ "aws-key": 1, "org-pattern": 1 });
  });
});
