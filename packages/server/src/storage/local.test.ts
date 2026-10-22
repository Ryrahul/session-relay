import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalDiskStorage } from "./local.js";
import { transcriptKey } from "./index.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "relay-storage-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("LocalDiskStorage", () => {
  it("round-trips a blob under an org-scoped key", async () => {
    const s = new LocalDiskStorage(dir);
    const key = transcriptKey("org_A", "rs_1");
    await s.put(key, new TextEncoder().encode("hello"));
    expect(new TextDecoder().decode((await s.get(key))!)).toBe("hello");
    await s.delete(key);
    expect(await s.get(key)).toBeNull();
  });

  it("refuses keys that escape the root", async () => {
    const s = new LocalDiskStorage(dir);
    await expect(s.put("../evil", new Uint8Array())).rejects.toThrow("Invalid storage key");
  });
});
