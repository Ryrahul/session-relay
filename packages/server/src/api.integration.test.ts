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

  it("lets admins edit org settings and validates patterns", async () => {
    const before = await call(alice.token, "GET", "/v1/org");
    expect(before.body).toMatchObject({ id: orgA, settings: { retention_days: 90 } });
    expect(before.body.stats.members).toBeGreaterThanOrEqual(3);
    expect((await call(alice.token, "PATCH", "/v1/org", { retention_days: 30 })).status).toBe(403);
    expect((await call(owner.token, "PATCH", "/v1/org", { redaction_patterns: ["(unclosed"] })).status).toBe(400);
    expect((await call(owner.token, "PATCH", "/v1/org", { retention_days: 0 })).status).toBe(400);
    const ok = await call(owner.token, "PATCH", "/v1/org", {
      name: "Team A Renamed",
      retention_days: 30,
      repo_allowlist: [" GitHub.com/Acme/* "],
      redaction_patterns: ["ACME-[0-9]{6}"],
    });
    expect(ok.status).toBe(200);
    const after = await call(alice.token, "GET", "/v1/me");
    expect(after.body.org.name).toBe("Team A Renamed");
    expect(after.body.settings).toEqual({ retention_days: 30, repo_allowlist: ["github.com/acme/*"], redaction_patterns: ["ACME-[0-9]{6}"], share_templates: [] });
    expect((await call(outsider.token, "GET", "/v1/org")).body.id).toBe(orgB);
    await call(owner.token, "PATCH", "/v1/org", { retention_days: 90, repo_allowlist: [], redaction_patterns: [] });
  });

  it("links handoff chains and shows them on both ends", async () => {
    const a = await call(alice.token, "POST", "/v1/sessions", { session: upload({ title: "chain A" }) });
    const b = await call(bob.token, "POST", "/v1/sessions", { session: upload({ title: "chain B", continues: a.body.id }) });
    expect(b.status).toBe(201);
    const c = await call(owner.token, "POST", "/v1/sessions", { session: upload({ title: "chain C", continues: b.body.id }) });

    const detailC = await call(alice.token, "GET", `/v1/sessions/${c.body.id}?mode=summary`);
    expect(detailC.body.continues).toBe(b.body.id);
    expect(detailC.body.chain.map((x: any) => x.title)).toEqual(["chain A", "chain B"]);
    expect(detailC.body.chain[1]).toMatchObject({ author: { name: "Bob" }, tool: "claude-code" });
    expect(detailC.body.continued_by).toEqual([]);

    const detailA = await call(bob.token, "GET", `/v1/sessions/${a.body.id}?mode=summary`);
    expect(detailA.body.chain).toEqual([]);
    expect(detailA.body.continued_by.map((x: any) => x.title)).toEqual(["chain B"]);

    const list = await call(alice.token, "GET", "/v1/sessions?q=chain");
    expect(list.body.sessions.find((x: any) => x.id === c.body.id).continues_id).toBe(b.body.id);

    // Deleting the middle link keeps the rest of the trail readable.
    await call(bob.token, "DELETE", `/v1/sessions/${b.body.id}`);
    const after = await call(alice.token, "GET", `/v1/sessions/${c.body.id}?mode=summary`);
    expect(after.body.chain.map((x: any) => x.title)).toEqual(["chain A"]);
  });

  it("only continues sessions you can see, in your org", async () => {
    const priv = await call(alice.token, "POST", "/v1/sessions", { session: upload({ title: "only bob", visibility: { team: false, people: [bob.userId] } }) });
    const denied = await call(owner.token, "POST", "/v1/sessions", { session: upload({ continues: priv.body.id }) });
    expect(denied.status).toBe(400);
    expect(denied.body.error).toMatch(/not visible/);
    expect((await call(bob.token, "POST", "/v1/sessions", { session: upload({ continues: priv.body.id }) })).status).toBe(201);
    const other = await call(outsider.token, "POST", "/v1/sessions", { session: upload({ continues: priv.body.id }) });
    expect(other.status).toBe(400);
    // A private parent stays hidden from people who can't see it, even in someone else's chain.
    const child = await call(bob.token, "POST", "/v1/sessions", { session: upload({ title: "public child", continues: priv.body.id }) });
    const asOwner = await call(owner.token, "GET", `/v1/sessions/${child.body.id}?mode=summary`);
    expect(asOwner.body.chain).toEqual([]);
  });

  const pub = (method: string, route: string, body?: unknown) =>
    app.request(route, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
      .then(async (r) => ({ status: r.status, body: (await r.json()) as any }));

  it("invite links: admins only, single use, joins with the right role", async () => {
    expect((await call(alice.token, "POST", "/v1/invites", {})).status).toBe(403);
    expect((await call(owner.token, "POST", "/v1/invites", { role: "owner" })).status).toBe(201);
    const inv = await call(owner.token, "POST", "/v1/invites", { role: "admin", expires_days: 3, note: "for dana" });
    expect(inv.status).toBe(201);
    expect(inv.body.url).toMatch(/\/#\/join\/inv_[A-Za-z0-9_-]{20,}$/);
    const secret = inv.body.url.split("/join/")[1];

    const info = await pub("GET", `/v1/join/${secret}`);
    expect(info.status).toBe(200);
    expect(info.body.role).toBe("admin");
    expect(typeof info.body.org).toBe("string");

    const joined = await pub("POST", `/v1/join/${secret}`, { name: "Dana", email: "Dana@Example.dev" });
    expect(joined.status).toBe(201);
    const me = await call(joined.body.token, "GET", "/v1/me");
    expect(me.body).toMatchObject({ role: "admin", user: { name: "Dana", email: "dana@example.dev" }, org: { id: orgA } });

    // Single use, and the link can't be read again.
    expect((await pub("POST", `/v1/join/${secret}`, { name: "Eve", email: "eve2@example.dev" })).status).toBe(404);
    expect((await pub("GET", `/v1/join/${secret}`)).status).toBe(404);
    expect((await pub("GET", "/v1/join/inv_madeupmadeupmadeupmadeup")).status).toBe(404);

    const list = await call(owner.token, "GET", "/v1/invites");
    expect(list.body.invites.find((i: any) => i.id === inv.body.id)).toMatchObject({ status: "used", used_by: "Dana", note: "for dana" });
    expect((await call(outsider.token, "GET", "/v1/invites")).body.invites).toEqual([]);
  });

  it("invite links: revoked and expired links don't work; concurrent use only succeeds once", async () => {
    const a = await call(owner.token, "POST", "/v1/invites", {});
    expect((await call(outsider.token, "DELETE", `/v1/invites/${a.body.id}`)).status).toBe(404);
    expect((await call(owner.token, "DELETE", `/v1/invites/${a.body.id}`)).status).toBe(200);
    expect((await pub("POST", `/v1/join/${a.body.url.split("/join/")[1]}`, { name: "X", email: "x1@example.dev" })).status).toBe(404);

    const b = await call(owner.token, "POST", "/v1/invites", {});
    await sql`UPDATE invites SET expires_at = now() - interval '1 minute' WHERE id = ${b.body.id}`;
    expect((await pub("POST", `/v1/join/${b.body.url.split("/join/")[1]}`, { name: "X", email: "x2@example.dev" })).status).toBe(404);

    const c = await call(owner.token, "POST", "/v1/invites", {});
    const s = c.body.url.split("/join/")[1];
    const results = await Promise.all([
      pub("POST", `/v1/join/${s}`, { name: "Race 1", email: "race1@example.dev" }),
      pub("POST", `/v1/join/${s}`, { name: "Race 2", email: "race2@example.dev" }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 404]);
  });

  it("browser login: approve once, token handed out once, in the approver's org", async () => {
    const start = await pub("POST", "/v1/auth/device", { client_name: "Bob's MacBook" });
    expect(start.status).toBe(201);
    expect(start.body.user_code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(start.body.verification_url).toContain(`/#/device/${start.body.user_code}`);
    const poll = () => pub("POST", "/v1/auth/device/token", { device_code: start.body.device_code });

    expect((await poll()).body.status).toBe("pending");
    expect((await pub("GET", `/v1/auth/device/${start.body.user_code}`)).status).toBe(401);
    const info = await call(bob.token, "GET", `/v1/auth/device/${start.body.user_code.toLowerCase().replace("-", "")}`);
    expect(info.body.client_name).toBe("Bob's MacBook");

    expect((await call(bob.token, "POST", "/v1/auth/device/approve", { user_code: start.body.user_code })).status).toBe(200);
    const done = await poll();
    expect(done.body.status).toBe("approved");
    const me = await call(done.body.token, "GET", "/v1/me");
    expect(me.body).toMatchObject({ user: { name: "Bob" }, org: { id: orgA } });
    expect((await poll()).status).toBe(410); // handed out once
    expect((await call(alice.token, "POST", "/v1/auth/device/approve", { user_code: start.body.user_code })).status).toBe(404);
    const tokens = await call(bob.token, "GET", "/v1/tokens");
    expect(tokens.body.tokens.some((t: any) => t.name === "CLI · Bob's MacBook")).toBe(true);
  });

  it("browser login: denied and expired codes never yield a token", async () => {
    const d = await pub("POST", "/v1/auth/device", { client_name: "suspicious" });
    await call(owner.token, "POST", "/v1/auth/device/deny", { user_code: d.body.user_code });
    const denied = await pub("POST", "/v1/auth/device/token", { device_code: d.body.device_code });
    expect(denied.status).toBe(403);
    expect(denied.body.status).toBe("denied");
    expect((await call(owner.token, "POST", "/v1/auth/device/approve", { user_code: d.body.user_code })).status).toBe(404);

    const e = await pub("POST", "/v1/auth/device", {});
    await sql`UPDATE device_logins SET expires_at = now() - interval '1 second' WHERE user_code = ${e.body.user_code}`;
    expect((await call(owner.token, "POST", "/v1/auth/device/approve", { user_code: e.body.user_code })).status).toBe(404);
    expect((await pub("POST", "/v1/auth/device/token", { device_code: e.body.device_code })).body.status).toBe("expired");
    expect((await pub("POST", "/v1/auth/device/token", { device_code: "dev_notarealcodenotarealcode" })).status).toBe(404);
  });

  it("edits a share: summary, who it's for and the PR; only author or admin", async () => {
    const { body } = await call(alice.token, "POST", "/v1/sessions", { session: upload({ title: "edit me", repo: "github.com/acme/edits" }) });
    const id = body.id;
    const summary = { goal: "new goal", decisions: ["d1"], done: ["x"], next: ["ship it"], open_questions: [] };
    expect((await call(bob.token, "PATCH", `/v1/sessions/${id}`, { summary })).status).toBe(403);
    expect((await call(alice.token, "PATCH", `/v1/sessions/${id}`, { pr_url: "javascript:alert(1)" })).status).toBe(400);
    expect((await call(alice.token, "PATCH", `/v1/sessions/${id}`, { assignee: outsider.userId })).status).toBe(400);
    const pr = "https://github.com/acme/edits/pull/42";
    expect((await call(alice.token, "PATCH", `/v1/sessions/${id}`, { summary, assignee: bob.userId, pr_url: pr })).status).toBe(200);
    const got = (await call(bob.token, "GET", `/v1/sessions/${id}?mode=summary`)).body;
    expect(got.summary.goal).toBe("new goal");
    expect(got.assigned_to).toEqual({ id: bob.userId, name: "Bob" });
    expect(got.pr_url).toBe(pr);
    expect(got.updated_at).toBeTruthy();
    // Search sees the edited summary.
    const found = (await call(bob.token, "GET", "/v1/sessions?q=ship+it&repo=github.com/acme/edits")).body.sessions;
    expect(found.map((x: any) => x.id)).toContain(id);
    // null clears.
    await call(owner.token, "PATCH", `/v1/sessions/${id}`, { assignee: null, pr_url: null });
    const cleared = (await call(alice.token, "GET", `/v1/sessions/${id}?mode=summary`)).body;
    expect(cleared.assigned_to).toBeNull();
    expect(cleared.pr_url).toBeUndefined();
  });

  it("handoffs for someone: listed with assignee=me and visible to them even when private", async () => {
    const r = await call(alice.token, "POST", "/v1/sessions", {
      session: upload({ title: "for bob only", repo: "github.com/acme/assign", assignee: bob.userId, visibility: { team: false, people: [] } }),
    });
    expect(r.status).toBe(201);
    const mine = (await call(bob.token, "GET", "/v1/sessions?assignee=me")).body.sessions;
    expect(mine.map((x: any) => x.id)).toEqual([r.body.id]);
    expect(mine[0].assignee).toEqual({ id: bob.userId, name: "Bob" });
    expect((await call(bob.token, "GET", `/v1/sessions/${r.body.id}`)).status).toBe(200);
    expect((await call(owner.token, "GET", "/v1/sessions?assignee=me")).body.sessions).toEqual([]);
    expect((await call(alice.token, "POST", "/v1/sessions", { session: upload({ assignee: outsider.userId }) })).status).toBe(400);
  });

  it("filters by touched file and branch, also as file:/branch: in the query", async () => {
    const repo = "github.com/acme/files";
    const a = (await call(alice.token, "POST", "/v1/sessions", { session: upload({ repo, branch: "main", files_touched: ["src/billing/invoice.ts"], title: "invoice rounding" }) })).body.id;
    const b = (await call(alice.token, "POST", "/v1/sessions", { session: upload({ repo, branch: "dev", files_touched: ["src/auth/login.ts"], title: "login rounding" }) })).body.id;
    const ids = async (qs: string) => (await call(bob.token, "GET", `/v1/sessions?repo=${repo}&${qs}`)).body.sessions.map((x: any) => x.id);
    expect(await ids("file=invoice")).toEqual([a]);
    expect(await ids("file=src%2Fauth")).toEqual([b]);
    expect(await ids("file=50%25")).toEqual([]);
    expect(await ids("q=file%3Ainvoice.ts")).toEqual([a]);
    expect(await ids("q=rounding+branch%3Adev")).toEqual([b]);
    expect((await ids("q=rounding")).sort()).toEqual([a, b].sort());
  });

  it("removing a member unassigns their handoffs", async () => {
    const carol = await makeUser(orgA, "Carol", "member");
    const id = (await call(alice.token, "POST", "/v1/sessions", { session: upload({ assignee: carol.userId }) })).body.id;
    expect((await call(owner.token, "DELETE", `/v1/members/${carol.userId}`)).status).toBe(200);
    expect((await call(alice.token, "GET", `/v1/sessions/${id}?mode=summary`)).body.assigned_to).toBeNull();
  });

  it("comments: visible members comment, author or admin deletes, shown on the session and counted in lists", async () => {
    const repo = "github.com/acme/comments";
    const id = (await call(alice.token, "POST", "/v1/sessions", { session: upload({ repo, title: "commented" }) })).body.id;
    expect((await call(bob.token, "POST", `/v1/sessions/${id}/comments`, { body: "  " })).status).toBe(400);
    const c1 = (await call(bob.token, "POST", `/v1/sessions/${id}/comments`, { body: "picked this up; tests fail on node 20" })).body.id;
    await call(alice.token, "POST", `/v1/sessions/${id}/comments`, { body: "thanks!" });
    // Typed in the web app: secrets are removed on the server.
    await call(owner.token, "POST", `/v1/sessions/${id}/comments`, { body: "use AKIAIOSFODNN7EXAMPLE for now" });
    const all = (await call(owner.token, "GET", `/v1/sessions/${id}/comments`)).body.comments;
    expect(all.at(-1).body).not.toContain("AKIAIOSFODNN7EXAMPLE");
    await call(owner.token, "DELETE", `/v1/sessions/${id}/comments/${all.at(-1).id}`);
    const detail = (await call(owner.token, "GET", `/v1/sessions/${id}?mode=summary`)).body;
    expect(detail.comments.map((c: any) => [c.author.name, c.body])).toEqual([["Bob", "picked this up; tests fail on node 20"], ["Alice", "thanks!"]]);
    expect((await call(bob.token, "GET", `/v1/sessions?repo=${repo}`)).body.sessions[0].comment_count).toBe(2);
    expect((await call(alice.token, "DELETE", `/v1/sessions/${id}/comments/${c1}`)).status).toBe(403);
    expect((await call(outsider.token, "POST", `/v1/sessions/${id}/comments`, { body: "hi" })).status).toBe(404);
    expect((await call(bob.token, "DELETE", `/v1/sessions/${id}/comments/${c1}`)).status).toBe(200);
    expect((await call(bob.token, "GET", `/v1/sessions/${id}/comments`)).body.comments).toHaveLength(1);
    // Private shares: people who can't see the session can't comment on it.
    const priv = (await call(alice.token, "POST", "/v1/sessions", { session: upload({ repo, visibility: { team: false, people: [] } }) })).body.id;
    expect((await call(bob.token, "POST", `/v1/sessions/${priv}/comments`, { body: "x" })).status).toBe(404);
    // Deleting the share deletes its comments.
    await call(alice.token, "DELETE", `/v1/sessions/${id}`);
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM session_comments WHERE session_id = ${id}`;
    expect(n).toBe(0);
  });

  it("activity and stats: pickups, comments, shares by day/tool/repo/person, only visible sessions listed", async () => {
    const team = await makeOrg("Stats Team");
    const ann = await makeUser(team, "Ann", "owner");
    const ben = await makeUser(team, "Ben", "member");
    const a1 = (await call(ann.token, "POST", "/v1/sessions", { session: upload({ repo: "github.com/s/api" }) })).body.id;
    await call(ann.token, "POST", "/v1/sessions", { session: upload({ repo: "github.com/s/api", source: { tool: "zcode", native_id: "z" } }) });
    const hidden = (await call(ann.token, "POST", "/v1/sessions", { session: upload({ repo: "github.com/s/secret", visibility: { team: false, people: [] } }) })).body.id;
    // Ben opens a1 in the web app (not a pickup), then picks it up twice (counted once) and continues it.
    await call(ben.token, "GET", `/v1/sessions/${a1}`);
    await call(ben.token, "GET", `/v1/sessions/${a1}?pickup=1`);
    await call(ben.token, "GET", `/v1/sessions/${a1}?pickup=1`);
    await call(ben.token, "POST", "/v1/sessions", { session: upload({ repo: "github.com/s/api", continues: a1 }) });
    await call(ben.token, "POST", `/v1/sessions/${a1}/comments`, { body: "on it" });
    await call(ann.token, "GET", `/v1/sessions/${hidden}?pickup=1`);

    const act = (await call(ben.token, "GET", "/v1/activity?days=1")).body;
    expect(act.pickups.map((p: any) => [p.by.name, p.session_id])).toEqual([["Ben", a1]]); // Ann's pickup of a private share is hidden from Ben
    expect(act.comments.map((x: any) => [x.author.name, x.body])).toEqual([["Ben", "on it"]]);
    expect((await call(ann.token, "GET", "/v1/activity")).body.pickups).toHaveLength(2);

    const st = (await call(ben.token, "GET", "/v1/stats?days=7")).body;
    expect(st.days).toBe(7);
    expect(st.totals).toEqual({ shares: 4, pickups: 2, continued: 1, comments: 1, active_people: 2 });
    expect(st.by_day).toHaveLength(8);
    expect(st.by_day.at(-1)).toMatchObject({ shares: 4, pickups: 2 });
    expect(st.by_tool).toEqual([{ tool: "claude-code", shares: 3 }, { tool: "zcode", shares: 1 }]);
    expect(st.by_repo).toEqual([{ repo: "github.com/s/api", shares: 3 }]); // the private repo isn't shown to Ben
    expect(st.by_person.map((p: any) => [p.name, p.shares, p.pickups, p.comments])).toEqual([["Ann", 3, 1, 0], ["Ben", 1, 1, 1]]);
    // since filter on the list
    expect((await call(ben.token, "GET", `/v1/sessions?since=${encodeURIComponent(new Date(Date.now() + 60_000).toISOString())}`)).body.sessions).toEqual([]);
    expect((await call(outsider.token, "GET", "/v1/stats")).body.totals.shares).toBe(0);
  });

  it("drafts: only the author sees them, they skip stats, and publishing shares them now", async () => {
    const team = await makeOrg("Drafts Team");
    const dee = await makeUser(team, "Dee", "member");
    const eli = await makeUser(team, "Eli", "admin");
    const id = (await call(dee.token, "POST", "/v1/sessions", { session: upload({ native_id: "n", source: { tool: "claude-code", native_id: "native-d" }, draft: true, visibility: { team: true, people: [] } }) })).body.id;
    // Hidden from everyone else, admins included, even with team visibility.
    expect((await call(eli.token, "GET", `/v1/sessions/${id}`)).status).toBe(404);
    expect((await call(eli.token, "GET", "/v1/sessions")).body.sessions).toEqual([]);
    // The author's normal list leaves drafts out; drafts=only / native_id find them.
    expect((await call(dee.token, "GET", "/v1/sessions")).body.sessions).toEqual([]);
    const mine = (await call(dee.token, "GET", "/v1/sessions?drafts=only")).body.sessions;
    expect(mine.map((s: any) => [s.id, s.draft])).toEqual([[id, true]]);
    expect((await call(dee.token, "GET", "/v1/sessions?native_id=native-d&drafts=include")).body.sessions).toHaveLength(1);
    expect((await call(eli.token, "GET", "/v1/stats?days=1")).body.totals.shares).toBe(0);
    // Publish.
    expect((await call(dee.token, "PATCH", `/v1/sessions/${id}`, { draft: false, visibility: { team: true, people: [] } })).status).toBe(200);
    expect((await call(eli.token, "GET", `/v1/sessions/${id}`)).body.draft).toBe(false);
    expect((await call(eli.token, "GET", "/v1/stats?days=1")).body.totals.shares).toBe(1);
    expect((await call(dee.token, "PATCH", `/v1/sessions/${id}`, { draft: true })).status).toBe(400);
  });

  it("exports a session as Markdown or JSON (full transcript), and a repo as NDJSON", async () => {
    const repo = "github.com/acme/export";
    const transcript = Array.from({ length: 300 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text: `full message ${i}` }) as const);
    const id = (await call(alice.token, "POST", "/v1/sessions", { session: upload({ repo, title: "Export me!", include: "full" }), transcript })).body.id;
    await call(alice.token, "POST", "/v1/sessions", { session: upload({ repo, title: "second" }) });
    await call(alice.token, "POST", "/v1/sessions", { session: upload({ repo, title: "hidden", visibility: { team: false, people: [] } }) });

    const md = await app.request(`/v1/sessions/${id}/export`, { headers: { authorization: `Bearer ${bob.token}` } });
    expect(md.headers.get("content-type")).toContain("text/markdown");
    expect(md.headers.get("content-disposition")).toContain(`${id}-export-me.md`);
    const text = await md.text();
    expect(text).toContain("# Export me!");
    expect(text).toContain("messages 1–300 of 300");
    const json = (await call(bob.token, "GET", `/v1/sessions/${id}/export?format=json`)).body;
    expect(json.messages).toHaveLength(300);
    expect((await call(outsider.token, "GET", `/v1/sessions/${id}/export`)).status).toBe(404);

    const nd = await app.request(`/v1/sessions/export?repo=${repo}`, { headers: { authorization: `Bearer ${bob.token}` } });
    const lines = (await nd.text()).trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.map((l) => l.title).sort()).toEqual(["Export me!", "second"]); // not the private one
    expect(lines.find((l) => l.id === id).messages).toHaveLength(40); // stored tail without full=1
    const ndFull = await app.request(`/v1/sessions/export?repo=${repo}&full=1`, { headers: { authorization: `Bearer ${bob.token}` } });
    expect((await ndFull.text()).trim().split("\n").map((l) => JSON.parse(l)).find((l) => l.id === id).messages).toHaveLength(300);
  });

  it("audit log: admins only, newest first, filters and paging", async () => {
    expect((await call(alice.token, "GET", "/v1/audit")).status).toBe(403);
    const first = (await call(owner.token, "GET", "/v1/audit?limit=5")).body;
    expect(first.entries).toHaveLength(5);
    expect(first.entries[0].id).toBeGreaterThan(first.entries[4].id);
    const next = (await call(owner.token, "GET", `/v1/audit?limit=5&before=${first.next}`)).body;
    expect(next.entries[0].id).toBeLessThan(first.entries[4].id);
    const exports = (await call(owner.token, "GET", "/v1/audit?action=session.export")).body.entries;
    expect(exports.length).toBeGreaterThanOrEqual(3);
    expect(exports.every((e: any) => e.action === "session.export")).toBe(true);
    const shares = (await call(owner.token, "GET", `/v1/audit?action=session.share&user=${alice.userId}`)).body.entries;
    expect(shares.length).toBeGreaterThan(0);
    expect(shares[0].user.name).toBe("Alice");
    expect(shares.some((e: any) => e.session_title)).toBe(true);
    expect((await call(outsider.token, "GET", "/v1/audit?action=session.share")).body.entries.every((e: any) => e.user?.name !== "Alice")).toBe(true);
  });

  it("handoff templates: admins set them, members read the match, sessions report missing sections", async () => {
    const templates = [
      { repo: "github.com/acme/*", instructions: "Mention flags.", sections: [{ title: "Tests run", hint: "commands", required: true }, { title: "Risks", required: false }] },
      { repo: "*", sections: [] },
    ];
    expect((await call(alice.token, "PATCH", "/v1/org", { share_templates: templates })).status).toBe(403);
    expect((await call(owner.token, "PATCH", "/v1/org", { share_templates: [{ repo: "", sections: [] }] })).status).toBe(400);
    expect((await call(owner.token, "PATCH", "/v1/org", { share_templates: templates })).status).toBe(200);
    expect((await call(alice.token, "GET", "/v1/me")).body.settings.share_templates).toHaveLength(2);
    const got = (await call(alice.token, "GET", "/v1/org/template?repo=github.com/acme/tpl")).body.template;
    expect(got).toMatchObject({ repo: "github.com/acme/*", sections: [{ title: "Tests run", required: true, hint: "commands" }, { title: "Risks", required: false, hint: "" }] });
    expect((await call(alice.token, "GET", "/v1/org/template?repo=gitlab.com/x")).body.template.repo).toBe("*");

    const id = (await call(alice.token, "POST", "/v1/sessions", { session: upload({ repo: "github.com/acme/tpl" }) })).body.id;
    expect((await call(bob.token, "GET", `/v1/sessions/${id}?mode=summary`)).body.missing_sections).toEqual(["Tests run"]);
    const sections = [{ title: "tests run", items: ["npm test: 15 passed"] }];
    const cur = (await call(alice.token, "GET", `/v1/sessions/${id}?mode=summary`)).body.summary;
    await call(alice.token, "PATCH", `/v1/sessions/${id}`, { summary: { ...cur, sections } });
    const after = (await call(bob.token, "GET", `/v1/sessions/${id}?mode=summary`)).body;
    expect(after.missing_sections).toEqual([]);
    expect(after.summary.sections).toEqual(sections);
    // Search covers section text too (it's part of the summary).
    expect((await call(bob.token, "GET", "/v1/sessions?q=passed&repo=github.com/acme/tpl")).body.sessions.map((x: any) => x.id)).toContain(id);
    const [log] = (await call(owner.token, "GET", "/v1/audit?action=org.update&limit=1")).body.entries;
    expect(log.meta.share_templates).toBe(2);
    await call(owner.token, "PATCH", "/v1/org", { share_templates: [] });
  });

  it("diffs: attached at share time, served as a patch, counted, exported, deleted with the share", async () => {
    const diff = "diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1 +1,2 @@\n-old\n+new\n+more\n";
    const id = (await call(alice.token, "POST", "/v1/sessions", { session: upload({ repo: "github.com/acme/diffs", title: "with diff" }), diff })).body.id;
    const none = (await call(alice.token, "POST", "/v1/sessions", { session: upload({ repo: "github.com/acme/diffs", title: "no diff" }) })).body.id;
    expect((await call(bob.token, "GET", `/v1/sessions/${id}?mode=summary`)).body.diff).toEqual({ files: 1, additions: 2, deletions: 1 });
    expect((await call(bob.token, "GET", `/v1/sessions/${none}?mode=summary`)).body.diff).toBeNull();
    const rows = (await call(bob.token, "GET", "/v1/sessions?repo=github.com/acme/diffs")).body.sessions;
    expect(Object.fromEntries(rows.map((r: any) => [r.title, r.has_diff]))).toEqual({ "with diff": true, "no diff": false });
    const res = await app.request(`/v1/sessions/${id}/diff`, { headers: { authorization: `Bearer ${bob.token}` } });
    expect(res.headers.get("content-type")).toContain("text/x-diff");
    expect(await res.text()).toBe(diff);
    expect((await call(bob.token, "GET", `/v1/sessions/${none}/diff`)).status).toBe(404);
    expect((await call(outsider.token, "GET", `/v1/sessions/${id}/diff`)).status).toBe(404);
    const md = await (await app.request(`/v1/sessions/${id}/export`, { headers: { authorization: `Bearer ${bob.token}` } })).text();
    expect(md).toContain("## Uncommitted changes");
    expect(md).toContain("+more");
    expect(await storage.get(`${orgA}/${id}.diff.gz`)).not.toBeNull();
    await call(alice.token, "DELETE", `/v1/sessions/${id}`);
    expect(await storage.get(`${orgA}/${id}.diff.gz`)).toBeNull();
    expect((await call(alice.token, "POST", "/v1/sessions", { session: upload(), diff: "x".repeat(1_000_001) })).status).toBe(400);
  });

  it("records usage and audit events", async () => {
    const [u] = await sql`SELECT count(*)::int AS n FROM usage_events WHERE org_id = ${orgA} AND kind = 'session.share'`;
    const [a] = await sql`SELECT count(*)::int AS n FROM audit_log WHERE org_id = ${orgA} AND action = 'session.pull'`;
    expect(u!.n).toBeGreaterThan(5);
    expect(a!.n).toBeGreaterThan(0);
  });
});
