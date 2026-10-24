import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { forgetPickup, lastPickup, recordPickup, resolveContinues } from "./pickups.js";

let dir: string;
const saved = process.env.RELAY_CONFIG;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "relay-pickups-"));
  process.env.RELAY_CONFIG = path.join(dir, "config.json");
});
afterEach(async () => {
  process.env.RELAY_CONFIG = saved;
  await rm(dir, { recursive: true, force: true });
});

describe("pickups", () => {
  it("keeps a separate memory per account config", async () => {
    await recordPickup("/work/api", "rs_A");
    process.env.RELAY_CONFIG = path.join(dir, "other.json");
    expect(await lastPickup("/work/api")).toBeNull();
    await recordPickup("/work/api", "rs_B");
    process.env.RELAY_CONFIG = path.join(dir, "config.json");
    expect(await lastPickup("/work/api")).toBe("rs_A");
  });

  it("remembers the last pickup per repo for 7 days", async () => {
    const t0 = new Date("2026-10-24T10:00:00Z");
    await recordPickup("/work/api", "rs_A", t0);
    await recordPickup("/work/web", "rs_B", t0);
    expect(await lastPickup("/work/api", t0)).toBe("rs_A");
    expect(await lastPickup("/work/web", t0)).toBe("rs_B");
    expect(await lastPickup("/work/other", t0)).toBeNull();
    expect(await lastPickup("/work/api", new Date("2026-10-31T09:00:00Z"))).toBe("rs_A");
    expect(await lastPickup("/work/api", new Date("2026-11-01T11:00:00Z"))).toBeNull();
  });

  it("resolves what a share continues", async () => {
    await recordPickup("/work/api", "rs_A");
    expect(await resolveContinues("/work/api")).toEqual({ id: "rs_A", auto: true });
    expect(await resolveContinues("/work/api", "rs_X")).toEqual({ id: "rs_X", auto: false });
    expect(await resolveContinues("/work/api", "none")).toEqual({ auto: false });
    await forgetPickup("/work/api");
    expect(await resolveContinues("/work/api")).toEqual({ auto: false });
  });
});
