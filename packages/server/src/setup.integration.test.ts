/** First-run setup against a real Postgres (its own database, so it can start empty). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { createDb, type Sql } from "./db/client.js";
import { migrate } from "./db/migrate.js";
import { generateSetupCode, SetupGate, setupBanner } from "./setup.js";
import { LocalDiskStorage } from "./storage/local.js";

const DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!DB)("first-run setup (integration)", () => {
  let admin: Sql;
  let sql: Sql;
  const code = "ABCD-EFGH-JKLM";
  let gate: SetupGate;
  let app: ReturnType<typeof createApp>;
  const post = (body: unknown) =>
    app.request("/v1/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const good = { code, org: "Acme Robotics", name: "Ada Owner", email: "Ada@Acme.dev" };

  beforeAll(async () => {
    admin = createDb(DB!);
    await admin.unsafe("DROP DATABASE IF EXISTS relay_setup_test WITH (FORCE)");
    await admin.unsafe("CREATE DATABASE relay_setup_test");
    const url = new URL(DB!);
    url.pathname = "/relay_setup_test";
    sql = createDb(url.toString());
    await migrate(sql);
    gate = new SetupGate(code);
    app = createApp({ sql, storage: new LocalDiskStorage("/tmp/relay-setup-test"), setup: gate });
  });
  afterAll(async () => {
    await sql?.end();
    await admin?.unsafe("DROP DATABASE IF EXISTS relay_setup_test WITH (FORCE)");
    await admin?.end();
  });

  it("reports that setup is needed on an empty server", async () => {
    expect(await (await app.request("/v1/setup")).json()).toEqual({ needed: true });
  });

  it("rejects a wrong code and bad input", async () => {
    const wrong = await post({ ...good, code: "WRNG-WRNG-WRNG" });
    expect(wrong.status).toBe(403);
    expect((await wrong.json()).error).toMatch(/server logs/);
    expect((await post({ ...good, email: "not-an-email" })).status).toBe(400);
  });

  it("creates the org and its owner, and returns a working token", async () => {
    // Codes are compared ignoring case and dashes.
    const res = await post({ ...good, code: "abcdefghjklm" });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.org).toMatchObject({ name: "Acme Robotics", slug: "acme-robotics" });
    const me = await app.request("/v1/me", { headers: { authorization: `Bearer ${body.token}` } });
    expect(await me.json()).toMatchObject({ role: "owner", user: { name: "Ada Owner", email: "ada@acme.dev" }, org: { name: "Acme Robotics" } });
    const [audit] = await sql`SELECT action FROM audit_log WHERE action = 'org.setup'`;
    expect(audit).toBeTruthy();
  });

  it("can't run twice", async () => {
    expect(await (await app.request("/v1/setup")).json()).toEqual({ needed: false });
    expect((await post(good)).status).toBe(409);
    // Even with a fresh gate (e.g. a second server process), an existing org blocks it.
    const app2 = createApp({ sql, storage: new LocalDiskStorage("/tmp/relay-setup-test"), setup: new SetupGate(code) });
    const res = await app2.request("/v1/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(good) });
    expect(res.status).toBe(409);
    const [n] = await sql`SELECT count(*)::int AS n FROM orgs`;
    expect(n!.n).toBe(1);
  });

  it("only one of two simultaneous setups wins", async () => {
    await sql`TRUNCATE orgs, users CASCADE`;
    const a = createApp({ sql, storage: new LocalDiskStorage("/tmp/relay-setup-test"), setup: new SetupGate(code) });
    const b = createApp({ sql, storage: new LocalDiskStorage("/tmp/relay-setup-test"), setup: new SetupGate(code) });
    const req = (x: typeof a, org: string) =>
      x.request("/v1/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...good, org }) });
    const statuses = (await Promise.all([req(a, "First"), req(b, "Second")])).map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409]);
    const [n] = await sql`SELECT count(*)::int AS n FROM orgs`;
    expect(n!.n).toBe(1);
  });

  it("locks after too many wrong codes", () => {
    const g = new SetupGate(code);
    for (let i = 0; i < 10; i++) expect(() => g.check("NOPE-NOPE-NOPE", 1000)).toThrow(/not right/);
    expect(() => g.check(code, 2000)).toThrow(/Too many/);
    expect(() => g.check(code, 1000 + 16 * 60 * 1000)).not.toThrow();
  });

  it("generates readable codes and a clear banner", () => {
    expect(generateSetupCode()).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const banner = setupBanner("ABCD-EFGH-JKLM", "https://relay.example.com/");
    expect(banner).toContain("Open https://relay.example.com and enter this one-time setup code");
    expect(banner).toContain("ABCD-EFGH-JKLM");
  });
});
