import { describe, expect, it } from "vitest";
import { generateToken, hashToken } from "./auth.js";

describe("tokens", () => {
  it("are prefixed and hash deterministically", () => {
    const t = generateToken();
    expect(t.startsWith("srk_")).toBe(true);
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).not.toBe(hashToken(generateToken()));
  });
});
