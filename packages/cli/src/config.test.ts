import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { configPath, readConfig, writeConfig } from "./config.js";

let dir: string | undefined;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("config", () => {
  it("honours XDG_CONFIG_HOME", () => {
    expect(configPath({ XDG_CONFIG_HOME: "/x" })).toBe("/x/session-relay/config.json");
  });

  it("writes the token file readable only by the owner", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "relay-cli-"));
    const file = path.join(dir, "config.json");
    await writeConfig({ server: "https://relay.test", token: "srk_x" }, file);
    expect(await readConfig(file)).toEqual({ server: "https://relay.test", token: "srk_x" });
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it("returns null when missing", async () => {
    expect(await readConfig("/nonexistent/relay.json")).toBeNull();
  });
});
