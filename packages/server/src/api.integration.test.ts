/**
 * Runs the real API against a real Postgres. Skipped unless TEST_DATABASE_URL is set
 * (scripts/test-integration.sh starts a throwaway database and sets it).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, type SessionUpload } from "@session-relay/shared";
import { createApp } from "./app.js";
import { generateToken, hashToken } from "./auth.js";
import { createDb, type Sql } from "./db/client.js";
import { migrate } from "./db/migrate.js";
import { purgeExpired } from "./routes/sessions.js";
import { LocalDiskStorage } from "./storage/local.js";

const DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!DB)("API (integration)", () => {
  let sql: Sql;
  let dir: string;
  let storage: LocalDiskStorage;
  let app: ReturnType<typeof createApp>;

  async function makeOrg(name: string) {
    const orgId = newId("org");
    await sql`INSERT INTO orgs (id, name, slug) VALUES (${orgId}, ${name}, ${orgId.toLowerCase()})`;
    await sql`INSERT INTO org_settings (org_id) VALUES (${orgId})`;
    return orgId;
  }
  async function makeUser(orgId: string, name: string, role: "owner" | "admin" | "member") {
    const userId = newId("usr");
    const token = generateToken();
    await sql`INSERT INTO users (id, email, name) VALUES (${userId}, ${userId.toLowerCase() + "@test.dev"}, ${name})`;
    await sql`INSERT INTO memberships (org_id, user_id, role) VALUES (${orgId}, ${userId}, ${role})`;
    await sql`INSERT INTO api_tokens (id, org_id, user_id, token_hash, name)
              VALUES (${newId("tok")}, ${orgId}, ${userId}, ${hashToken(token)}, 'test')`;
    return { userId, token };
  }
  async function call(token: string, method: string, route: string, body?: unknown) {
    const res = await app.request(route, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as any };
  }
  function upload(over: Partial<SessionUpload> = {}): SessionUpload {
    return {
      source: { tool: "claude-code", native_id: "native-1", version: "2.1" },
      repo: "github.com/acme/payments",
      branch: "feat/webhooks",
      title: "add stripe webhook retry",
      summary: { goal: "retry failed webhooks with backoff", decisions: ["use idempotency keys"], done: [], next: ["load test"], open_questions: [] },
      files_touched: ["src/webhooks.ts"],
      messages: Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text: `message ${i} about idempotency` }) as const),
      include: "summary+tail",
      visibility: { team: true, people: [] },
      redactions: 0,
      ...over,
    };
  }

  let orgA: string, orgB: string;
  let owner: { userId: string; token: string };
  let alice: { userId: string; token: string };
  let bob: { userId: string; token: string };
  let outsider: { userId: string; token: string };

  beforeAll(async () => {
    sql = createDb(DB!);
    await sql.unsafe("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await migrate(sql);
    dir = await mkdtemp(path.join(tmpdir(), "relay-it-"));
    storage = new LocalDiskStorage(dir);
    app = createApp({ sql, storage });
    orgA = await makeOrg("Team A");
    orgB = await makeOrg("Team B");
    owner = await makeUser(orgA, "Olivia Owner", "owner");
    alice = await makeUser(orgA, "Alice", "member");
    bob = await makeUser(orgA, "Bob", "member");
    outsider = await makeUser(orgB, "Eve Outsider", "owner");
  });
  afterAll(async () => {
    await sql?.end();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("rejects missing and bad tokens", async () => {
    expect((await app.request("/v1/me")).status).toBe(401);
    expect((await call("srk_nope", "GET", "/v1/me")).status).toBe(401);
  });

  it("returns me with org settings", async () => {
    const { status, body } = await call(alice.token, "GET", "/v1/me");
    expect(status).toBe(200);
    expect(body.org.id).toBe(orgA);
    expect(body.role).toBe("member");
    expect(body.settings.retention_days).toBe(90);
  });

  it("shares, lists and pulls a tail", async () => {
    const shared = await call(alice.token, "POST", "/v1/sessions", { session: upload() });
    expect(shared.status).toBe(201);
    const id = shared.body.id;

    const list = await call(bob.token, "GET", "/v1/sessions?repo=github.com/acme/payments");
    expect(list.body.sessions.map((s: any) => s.id)).toContain(id);
    const item = list.body.sessions.find((s: any) => s.id === id);
    expect(item).toMatchObject({ author: { name: "Alice" }, goal: "retry failed webhooks with backoff", message_count: 40 });

    const tail = await call(bob.token, "GET", `/v1/sessions/${id}?mode=tail&tail=5`);
    expect(tail.body.messages).toHaveLength(5);
    expect(tail.body.messages[4].text).toBe("message 39 about idempotency");
    expect(tail.body).toMatchObject({ message_total: 40, message_offset: 35 });

    const summary = await call(bob.token, "GET", `/v1/sessions/${id}?mode=summary`);
    expect(summary.body.messages).toEqual([]);
  });

  it("stores full transcripts in blob storage and pages them", async () => {
    const transcript = Array.from({ length: 250 }, (_, i) => ({ role: "user" as const, text: `full ${i}` }));
    const { body } = await call(alice.token, "POST", "/v1/sessions", {
      session: upload({ include: "full", messages: transcript.slice(-30), title: "full one" }),
      transcript,
    });
    const page1 = await call(bob.token, "GET", `/v1/sessions/${body.id}?mode=full`);
    expect(page1.body.has_full_transcript).toBe(true);
    expect(page1.body.message_total).toBe(250);
    expect(page1.body.messages).toHaveLength(200);
    const page2 = await call(bob.token, "GET", `/v1/sessions/${body.id}?mode=full&offset=200`);
    expect(page2.body.messages[0].text).toBe("full 200");
    expect(page2.body.messages).toHaveLength(50);
  });

  it("searches titles, summaries and messages", async () => {
    await call(alice.token, "POST", "/v1/sessions", {
      session: upload({ title: "refund flow", summary: { goal: "partial refunds", decisions: [], done: [], next: [], open_questions: [] }, messages: [{ role: "user", text: "the ledger reconciliation is broken" }] }),
    });
    const byMsg = await call(bob.token, "GET", "/v1/sessions?q=reconciliation");
    expect(byMsg.body.sessions.map((s: any) => s.title)).toEqual(["refund flow"]);
    const byGoal = await call(bob.token, "GET", "/v1/sessions?q=refunds");
    expect(byGoal.body.sessions[0].title).toBe("refund flow");
    const byAuthor = await call(bob.token, "GET", "/v1/sessions?author=alice");
    expect(byAuthor.body.sessions.length).toBeGreaterThanOrEqual(3);
  });

  it("limits non-team shares to the chosen people", async () => {
    const { body } = await call(alice.token, "POST", "/v1/sessions", {
      session: upload({ title: "private for bob", visibility: { team: false, people: [bob.userId] } }),
    });
    expect((await call(bob.token, "GET", `/v1/sessions/${body.id}`)).status).toBe(200);
    expect((await call(owner.token, "GET", `/v1/sessions/${body.id}`)).status).toBe(404);
    expect((await call(alice.token, "GET", `/v1/sessions/${body.id}`)).status).toBe(200);
    const ownerList = await call(owner.token, "GET", "/v1/sessions?q=private");
    expect(ownerList.body.sessions).toEqual([]);
  });

  it("rejects people from another org", async () => {
    const res = await call(alice.token, "POST", "/v1/sessions", {
      session: upload({ visibility: { team: false, people: [outsider.userId] } }),
    });
    expect(res.status).toBe(400);
  });

  it("isolates orgs completely", async () => {
    const { body } = await call(alice.token, "POST", "/v1/sessions", { session: upload({ title: "team a secret" }) });
    expect((await call(outsider.token, "GET", `/v1/sessions/${body.id}`)).status).toBe(404);
    expect((await call(outsider.token, "GET", "/v1/sessions")).body.sessions).toEqual([]);
    expect((await call(outsider.token, "DELETE", `/v1/sessions/${body.id}`)).status).toBe(404);
    expect((await call(outsider.token, "GET", "/v1/members")).body.members.map((m: any) => m.name)).toEqual(["Eve Outsider"]);
  });

  it("lets only the author or an admin change or delete a share", async () => {
    const { body } = await call(alice.token, "POST", "/v1/sessions", { session: upload({ title: "to delete" }) });
    expect((await call(bob.token, "PATCH", `/v1/sessions/${body.id}`, { title: "hijack" })).status).toBe(403);
    expect((await call(bob.token, "DELETE", `/v1/sessions/${body.id}`)).status).toBe(403);
    expect((await call(alice.token, "PATCH", `/v1/sessions/${body.id}`, { title: "renamed" })).status).toBe(200);
    expect((await call(owner.token, "DELETE", `/v1/sessions/${body.id}`)).status).toBe(200);
    expect((await call(alice.token, "GET", `/v1/sessions/${body.id}`)).status).toBe(404);
  });

  it("deletes the transcript blob with the share", async () => {
    const transcript = [{ role: "user" as const, text: "x" }];
    const { body } = await call(alice.token, "POST", "/v1/sessions", { session: upload({ include: "full" }), transcript });
    const key = `${orgA}/${body.id}.json.gz`;
    expect(await storage.get(key)).not.toBeNull();
    await call(alice.token, "DELETE", `/v1/sessions/${body.id}`);
    expect(await storage.get(key)).toBeNull();
  });

  it("enforces the repo allowlist", async () => {
    await sql`UPDATE org_settings SET repo_allowlist = ${["github.com/acme/*"]} WHERE org_id = ${orgA}`;
    expect((await call(alice.token, "POST", "/v1/sessions", { session: upload({ repo: "github.com/other/x" }) })).status).toBe(403);
    expect((await call(alice.token, "POST", "/v1/sessions", { session: upload({ repo: "github.com/acme/web" }) })).status).toBe(201);
    await sql`UPDATE org_settings SET repo_allowlist = '{}' WHERE org_id = ${orgA}`;
  });

  it("purges expired shares", async () => {
    const { body } = await call(alice.token, "POST", "/v1/sessions", { session: upload({ include: "full", title: "old" }), transcript: [{ role: "user", text: "x" }] });
    await sql`UPDATE sessions SET expires_at = now() - interval '1 minute' WHERE id = ${body.id}`;
    expect((await call(alice.token, "GET", `/v1/sessions/${body.id}`)).status).toBe(404);
    expect(await purgeExpired(sql, storage)).toBeGreaterThanOrEqual(1);
    expect(await storage.get(`${orgA}/${body.id}.json.gz`)).toBeNull();
  });

  it("invites members (admins only) and their token works", async () => {
    expect((await call(alice.token, "POST", "/v1/members", { email: "x@test.dev", name: "X" })).status).toBe(403);
    const inv = await call(owner.token, "POST", "/v1/members", { email: "carol@test.dev", name: "Carol" });
    expect(inv.status).toBe(201);
    const me = await call(inv.body.token, "GET", "/v1/me");
    expect(me.body.user.name).toBe("Carol");
    expect((await call(owner.token, "POST", "/v1/members", { email: "carol@test.dev", name: "Carol" })).status).toBe(409);
    expect((await call(owner.token, "DELETE", `/v1/members/${inv.body.user.id}`)).status).toBe(200);
    expect((await call(inv.body.token, "GET", "/v1/me")).status).toBe(401);
  });

  it("revokes tokens", async () => {
    const created = await call(bob.token, "POST", "/v1/tokens", { name: "laptop 2" });
    expect((await call(created.body.token, "GET", "/v1/me")).status).toBe(200);
    expect((await call(bob.token, "DELETE", `/v1/tokens/${created.body.id}`)).status).toBe(200);
    expect((await call(created.body.token, "GET", "/v1/me")).status).toBe(401);
  });

  it("records usage and audit events", async () => {
    const [u] = await sql`SELECT count(*)::int AS n FROM usage_events WHERE org_id = ${orgA} AND kind = 'session.share'`;
    const [a] = await sql`SELECT count(*)::int AS n FROM audit_log WHERE org_id = ${orgA} AND action = 'session.pull'`;
    expect(u!.n).toBeGreaterThan(5);
    expect(a!.n).toBeGreaterThan(0);
  });
});
