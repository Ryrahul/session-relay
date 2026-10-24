import { gunzipSync, gzipSync } from "node:zlib";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  createRedactor,
  DetailMode,
  matchTemplate,
  missingSections,
  newId,
  NewComment,
  type Comment,
  SessionPatch,
  ShareRequest,
  type Message,
  type SessionDetail,
  type SessionListItem,
  type ChainLink,
  renderHandoff,
} from "@session-relay/shared";
import type { AppEnv, AuthContext } from "../auth.js";
import { audit, recordUsage } from "../audit.js";
import type { Sql } from "../db/client.js";
import { iso, parseBody } from "../http.js";
import { transcriptKey, type BlobStorage } from "../storage/types.js";
import { purgeRateLimits } from "../ratelimit.js";

const MAX_LIST = 100;
const MAX_CHAIN = 20;
const FULL_PAGE = 200;
const MAX_COMMENTS = 100;

/** Rows the caller may see: same org, live, and either team-visible, theirs, for them, or shared with them. */
export function visible(sql: Sql, auth: AuthContext) {
  return sql`
    s.org_id = ${auth.orgId}
    AND s.deleted_at IS NULL
    AND (s.expires_at IS NULL OR s.expires_at > now())
    AND (s.draft = false OR s.author_id = ${auth.userId})
    AND (
      s.visibility_team
      OR s.author_id = ${auth.userId}
      OR s.assignee_id = ${auth.userId}
      OR EXISTS (SELECT 1 FROM session_people p WHERE p.session_id = s.id AND p.user_id = ${auth.userId})
    )
  `;
}

/** Owner of the share, or an org admin. */
async function loadOwned(sql: Sql, auth: AuthContext, id: string) {
  const [row] = await sql`
    SELECT id, author_id, transcript_key FROM sessions
    WHERE id = ${id} AND org_id = ${auth.orgId} AND deleted_at IS NULL
  `;
  if (!row) throw new HTTPException(404, { message: "Session not found" });
  if (row.author_id !== auth.userId && auth.role === "member") {
    throw new HTTPException(403, { message: "Only the author or an admin can change this share" });
  }
  return row;
}

async function setPeople(sql: Sql, orgId: string, sessionId: string, people: string[]) {
  await sql`DELETE FROM session_people WHERE session_id = ${sessionId}`;
  if (!people.length) return;
  const found = await sql`SELECT user_id FROM memberships WHERE org_id = ${orgId} AND user_id IN ${sql(people)}`;
  if (found.length !== new Set(people).size) throw new HTTPException(400, { message: "Some people are not members of this org" });
  await sql`INSERT INTO session_people ${sql(people.map((user_id) => ({ session_id: sessionId, org_id: orgId, user_id })))}`;
}

async function requireMember(sql: Sql, orgId: string, userId: string) {
  const [m] = await sql`SELECT 1 FROM memberships WHERE org_id = ${orgId} AND user_id = ${userId}`;
  if (!m) throw new HTTPException(400, { message: "assignee is not a member of this org" });
}

/** "file:src/a.ts branch:main webhook retry" → filters plus the remaining free text. */
export function parseQuery(q: string): { text: string; file?: string; branch?: string } {
  const out: { text: string; file?: string; branch?: string } = { text: "" };
  const rest = q.replace(/\b(file|branch):(\S+)/g, (_, k: "file" | "branch", v: string) => {
    out[k] = v;
    return " ";
  });
  out.text = rest.replace(/\s+/g, " ").trim();
  return out;
}

function repoAllowed(allowlist: string[], repo: string): boolean {
  return allowlist.length === 0 || allowlist.some((a) => repo === a || (a.endsWith("/*") && repo.startsWith(a.slice(0, -1))));
}

export function sessionRoutes(sql: Sql, storage: BlobStorage) {
  const app = new Hono<AppEnv>();

  app.post("/", async (c) => {
    const auth = c.get("auth");
    const { session: s, transcript } = parseBody(ShareRequest, await c.req.json());

    const [settings] = await sql`SELECT retention_days, repo_allowlist FROM org_settings WHERE org_id = ${auth.orgId}`;
    if (s.continues) {
      const [parent] = await sql`SELECT s.id FROM sessions s WHERE s.id = ${s.continues} AND ${visible(sql, auth)}`;
      if (!parent) throw new HTTPException(400, { message: `continues: session ${s.continues} not found or not visible to you` });
    }
    if (s.assignee) await requireMember(sql, auth.orgId, s.assignee);
    if (!repoAllowed(settings!.repo_allowlist, s.repo)) {
      throw new HTTPException(403, { message: `Repo ${s.repo} is not on this org's allowlist` });
    }

    const id = newId("rs");
    const wantFull = s.include === "full" && transcript && transcript.length > 0;
    const blob = wantFull ? gzipSync(JSON.stringify(transcript)) : null;
    const key = blob ? transcriptKey(auth.orgId, id) : null;
    if (blob && key) await storage.put(key, blob);
    const messages = s.include === "summary" ? [] : s.messages;

    try {
      await sql.begin(async (tx) => {
        await tx`
          INSERT INTO sessions (
            id, org_id, author_id, source_tool, source_version, native_id, repo, branch, commit_sha,
            title, summary, files_touched, messages, include_mode, visibility_team, redactions,
            transcript_key, transcript_bytes, started_at, expires_at, continues_session_id, assignee_id, pr_url, draft
          ) VALUES (
            ${id}, ${auth.orgId}, ${auth.userId}, ${s.source.tool}, ${s.source.version ?? null}, ${s.source.native_id},
            ${s.repo}, ${s.branch ?? null}, ${s.commit ?? null}, ${s.title}, ${tx.json(s.summary)},
            ${s.files_touched}, ${tx.json(messages)}, ${s.include}, ${s.visibility.team}, ${s.redactions},
            ${key}, ${blob?.byteLength ?? null}, ${s.started_at ?? null},
            now() + make_interval(days => ${settings!.retention_days}),
            ${s.continues ?? null}, ${s.assignee ?? null}, ${s.pr_url ?? null}, ${s.draft}
          )
        `;
        if (!s.visibility.team) await setPeople(tx as unknown as Sql, auth.orgId, id, s.visibility.people);
      });
    } catch (err) {
      if (key) await storage.delete(key);
      throw err;
    }

    const bytes = Buffer.byteLength(JSON.stringify(messages)) + (blob?.byteLength ?? 0);
    await recordUsage(sql, auth, "session.share", bytes);
    if (s.draft) await audit(sql, auth, "session.draft", id, { repo: s.repo });
    else await audit(sql, auth, "session.share", id, { repo: s.repo, include: s.include, team: s.visibility.team, assignee: s.assignee ?? null });
    return c.json({ id }, 201);
  });

  app.get("/", async (c) => {
    const auth = c.get("auth");
    const q = c.req.query();
    const limit = Math.min(Number(q.limit) || 20, MAX_LIST);
    const author = q.author === "me" ? auth.userId : q.author;
    const assignee = q.assignee === "me" ? auth.userId : q.assignee;
    const parsed = parseQuery(q.q ?? "");
    const text = parsed.text;
    const branch = q.branch || parsed.branch;
    const file = q.file || parsed.file;

    const rows = await sql`
      SELECT s.id, s.title, s.repo, s.branch, s.source_tool, s.summary->>'goal' AS goal, s.include_mode,
             jsonb_array_length(s.messages) AS message_count, s.transcript_key IS NOT NULL AS has_full,
             s.visibility_team, s.continues_session_id, s.pr_url, s.draft, s.created_at, s.updated_at,
             u.id AS author_id, u.name AS author_name, a.id AS assignee_id, a.name AS assignee_name,
             (SELECT count(*)::int FROM session_comments c WHERE c.session_id = s.id AND c.deleted_at IS NULL) AS comment_count
             ${text ? sql`, ts_rank(s.search, websearch_to_tsquery('english', ${text})) AS rank` : sql``}
      FROM sessions s JOIN users u ON u.id = s.author_id LEFT JOIN users a ON a.id = s.assignee_id
      WHERE ${visible(sql, auth)}
        ${q.repo ? sql`AND s.repo = ${q.repo}` : sql``}
        ${branch ? sql`AND s.branch = ${branch}` : sql``}
        ${q.tool ? sql`AND s.source_tool = ${q.tool}` : sql``}
        ${author ? sql`AND (u.id = ${author} OR u.name ILIKE ${"%" + author + "%"} OR u.email ILIKE ${author + "%"})` : sql``}
        ${assignee ? sql`AND s.assignee_id = ${assignee}` : sql``}
        ${file ? sql`AND EXISTS (SELECT 1 FROM unnest(s.files_touched) f WHERE f ILIKE ${"%" + file.replace(/[\\%_]/g, (ch) => "\\" + ch) + "%"})` : sql``}
        ${q.pr ? sql`AND s.pr_url = ${q.pr}` : sql``}
        ${text ? sql`AND (s.search @@ websearch_to_tsquery('english', ${text}) OR s.title ILIKE ${"%" + text + "%"})` : sql``}
        ${q.before ? sql`AND s.created_at < ${q.before}` : sql``}
        ${q.since ? sql`AND s.created_at >= ${q.since}` : sql``}
        ${q.native_id ? sql`AND s.native_id = ${q.native_id}` : sql``}
        ${q.drafts === "only" ? sql`AND s.draft` : q.drafts === "include" ? sql`` : sql`AND NOT s.draft`}
      ORDER BY ${text ? sql`rank DESC,` : sql``} s.created_at DESC
      LIMIT ${limit}
    `;
    const sessions: SessionListItem[] = rows.map((r) => ({
      id: r.id,
      title: r.title,
      repo: r.repo,
      branch: r.branch,
      tool: r.source_tool,
      author: { id: r.author_id, name: r.author_name },
      goal: r.goal ?? "",
      include: r.include_mode,
      message_count: r.message_count,
      has_full_transcript: r.has_full,
      visibility_team: r.visibility_team,
      continues_id: r.continues_session_id,
      assignee: r.assignee_id ? { id: r.assignee_id, name: r.assignee_name } : null,
      pr_url: r.pr_url,
      comment_count: r.comment_count,
      draft: r.draft,
      created_at: r.created_at.toISOString(),
      updated_at: iso(r.updated_at),
    }));
    return c.json({ sessions });
  });

  /**
   * Every visible session matching the filters, one JSON object per line (newest first, at most 1000).
   * Registered before "/:id" so "export" isn't read as an id. `full=1` includes full transcripts.
   */
  app.get("/export", async (c) => {
    const auth = c.get("auth");
    const q = c.req.query();
    const rows = await sql`
      SELECT s.id FROM sessions s JOIN users u ON u.id = s.author_id
      WHERE ${visible(sql, auth)} AND NOT s.draft
        ${q.repo ? sql`AND s.repo = ${q.repo}` : sql``}
        ${q.since ? sql`AND s.created_at >= ${q.since}` : sql``}
        ${q.author === "me" ? sql`AND s.author_id = ${auth.userId}` : sql``}
      ORDER BY s.created_at DESC LIMIT 1000
    `;
    const full = q.full === "1";
    await audit(sql, auth, "session.export", null, { bulk: true, count: rows.length, repo: q.repo ?? null, full });
    c.header("content-type", "application/x-ndjson; charset=utf-8");
    c.header("content-disposition", `attachment; filename="sessions${q.repo ? "-" + q.repo.split("/").slice(-1)[0] : ""}.ndjson"`);
    const lines: string[] = [];
    for (const r of rows) {
      const d = await loadDetail(auth, r.id, full ? "full" : "tail", { all: full });
      if (d) lines.push(JSON.stringify(d));
    }
    return c.body(lines.join("\n") + (lines.length ? "\n" : ""));
  });

  /** A session as the caller may see it; `page` picks the window of messages. Null when not visible. */
  async function loadDetail(
    auth: AuthContext,
    id: string,
    mode: DetailMode,
    page: { tail?: unknown; offset?: unknown; limit?: unknown; all?: boolean } = {},
  ): Promise<SessionDetail | null> {
    const [r] = await sql`
      SELECT s.*, u.name AS author_name, a.name AS assignee_name
      FROM sessions s JOIN users u ON u.id = s.author_id LEFT JOIN users a ON a.id = s.assignee_id
      WHERE s.id = ${id} AND ${visible(sql, auth)}
    `;
    if (!r) return null;

    let all: Message[] = r.messages;
    if (mode === "full" && r.transcript_key) {
      const blob = await storage.get(r.transcript_key);
      if (blob) all = JSON.parse(gunzipSync(blob).toString("utf8"));
    }
    let window: Message[] = [];
    let offset = 0;
    if (mode === "tail") {
      const tail = Math.max(1, Number(page.tail) || all.length);
      offset = Math.max(0, all.length - tail);
      window = all.slice(offset);
    } else if (mode === "full") {
      offset = Math.max(0, Number(page.offset) || 0);
      const limit = page.all ? all.length : Math.min(Number(page.limit) || FULL_PAGE, 1000);
      window = all.slice(offset, offset + limit);
    }

    const people = await sql`
      SELECT u.id, u.name FROM session_people p JOIN users u ON u.id = p.user_id WHERE p.session_id = ${id}
    `;
    // Walk up the handoff chain (bounded), keeping only sessions the caller can see.
    const chain = await sql`
      WITH RECURSIVE up(id, parent, depth) AS (
        SELECT id, continues_session_id, 0 FROM sessions WHERE id = ${id} AND org_id = ${auth.orgId}
        UNION ALL
        SELECT x.id, x.continues_session_id, up.depth + 1
        FROM sessions x JOIN up ON x.id = up.parent
        WHERE up.depth < ${MAX_CHAIN} AND x.org_id = ${auth.orgId}
      )
      SELECT s.id, s.title, s.source_tool, s.created_at, u.id AS author_id, u.name AS author_name
      FROM up JOIN sessions s ON s.id = up.id JOIN users u ON u.id = s.author_id
      WHERE up.depth > 0 AND ${visible(sql, auth)}
      ORDER BY up.depth DESC
    `;
    const children = await sql`
      SELECT s.id, s.title, s.source_tool, s.created_at, u.id AS author_id, u.name AS author_name
      FROM sessions s JOIN users u ON u.id = s.author_id
      WHERE s.continues_session_id = ${id} AND ${visible(sql, auth)}
      ORDER BY s.created_at
    `;
    const comments = await listComments(sql, id, MAX_COMMENTS);
    const [settings] = await sql`SELECT share_templates FROM org_settings WHERE org_id = ${auth.orgId}`;
    const missing = missingSections(matchTemplate(settings?.share_templates ?? [], r.repo), r.summary);
    const link = (x: (typeof chain)[number]): ChainLink => ({
      id: x.id,
      title: x.title,
      tool: x.source_tool,
      author: { id: x.author_id, name: x.author_name },
      created_at: x.created_at.toISOString(),
    });
    const body: SessionDetail = {
      id: r.id,
      org_id: r.org_id,
      author: { id: r.author_id, name: r.author_name },
      source: { tool: r.source_tool, version: r.source_version ?? undefined, native_id: r.native_id },
      repo: r.repo,
      branch: r.branch ?? undefined,
      commit: r.commit_sha ?? undefined,
      title: r.title,
      summary: r.summary,
      files_touched: r.files_touched,
      messages: window,
      include: r.include_mode,
      visibility: { team: r.visibility_team, people: people.map((p) => p.id) },
      redactions: r.redactions,
      started_at: iso(r.started_at) ?? undefined,
      has_full_transcript: r.transcript_key !== null,
      created_at: r.created_at.toISOString(),
      expires_at: iso(r.expires_at),
      people: people.map((p) => ({ id: p.id, name: p.name })),
      message_total: all.length,
      message_offset: offset,
      continues: r.continues_session_id ?? undefined,
      assignee: r.assignee_id ?? undefined,
      pr_url: r.pr_url ?? undefined,
      draft: r.draft,
      updated_at: iso(r.updated_at),
      chain: chain.map(link),
      continued_by: children.map(link),
      assigned_to: r.assignee_id ? { id: r.assignee_id, name: r.assignee_name } : null,
      comments,
      missing_sections: missing,
    };
    return body;
  }

  app.get("/:id", async (c) => {
    const auth = c.get("auth");
    const id = c.req.param("id");
    const mode = DetailMode.catch("tail").parse(c.req.query("mode") ?? "tail");
    const body = await loadDetail(auth, id, mode, c.req.query());
    if (!body) throw new HTTPException(404, { message: "Session not found" });
    await recordUsage(sql, auth, `session.get.${mode}`);
    if (mode !== "summary") await audit(sql, auth, "session.pull", id, { mode });
    // The CLI and agents say when they load a session to continue it (relay pull, /pickup).
    if (c.req.query("pickup") === "1") await audit(sql, auth, "session.pickup", id);
    return c.json(body);
  });

  /** The whole session, full transcript included, as Markdown or JSON. */
  app.get("/:id/export", async (c) => {
    const auth = c.get("auth");
    const id = c.req.param("id");
    const format = c.req.query("format") === "json" ? "json" : "md";
    const body = await loadDetail(auth, id, "full", { all: true });
    if (!body) throw new HTTPException(404, { message: "Session not found" });
    await audit(sql, auth, "session.export", id, { format });
    const name = `${body.id}-${body.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "session"}`;
    if (format === "json") {
      c.header("content-disposition", `attachment; filename="${name}.json"`);
      return c.json(body);
    }
    c.header("content-type", "text/markdown; charset=utf-8");
    c.header("content-disposition", `attachment; filename="${name}.md"`);
    return c.body(renderHandoff(body));
  });

  app.patch("/:id", async (c) => {
    const auth = c.get("auth");
    const id = c.req.param("id");
    const patch = parseBody(SessionPatch, await c.req.json());
    await loadOwned(sql, auth, id);
    if (patch.assignee) await requireMember(sql, auth.orgId, patch.assignee);
    await sql.begin(async (tx) => {
      if (patch.title) await tx`UPDATE sessions SET title = ${patch.title} WHERE id = ${id}`;
      if (patch.summary) await tx`UPDATE sessions SET summary = ${tx.json(patch.summary)} WHERE id = ${id}`;
      if (patch.assignee !== undefined) await tx`UPDATE sessions SET assignee_id = ${patch.assignee} WHERE id = ${id}`;
      if (patch.pr_url !== undefined) await tx`UPDATE sessions SET pr_url = ${patch.pr_url} WHERE id = ${id}`;
      // Publishing restarts the clock: it counts as shared now, and expires from now.
      if (patch.draft === false) {
        await tx`
          UPDATE sessions SET draft = false, created_at = now(),
            expires_at = now() + make_interval(days => (SELECT retention_days FROM org_settings WHERE org_id = ${auth.orgId}))
          WHERE id = ${id} AND draft
        `;
      }
      if (patch.visibility) {
        await tx`UPDATE sessions SET visibility_team = ${patch.visibility.team} WHERE id = ${id}`;
        await setPeople(tx as unknown as Sql, auth.orgId, id, patch.visibility.team ? [] : patch.visibility.people);
      }
      await tx`UPDATE sessions SET updated_at = now() WHERE id = ${id}`;
    });
    // The summary can be long; the audit log only needs to know it changed.
    const { summary, ...rest } = patch;
    await audit(sql, auth, "session.update", id, { ...rest, ...(summary ? { summary: "edited" } : {}) });
    if (patch.draft === false) await audit(sql, auth, "session.share", id, { published: true });
    return c.json({ ok: true });
  });

  app.get("/:id/comments", async (c) => {
    const auth = c.get("auth");
    const id = c.req.param("id");
    const [s] = await sql`SELECT s.id FROM sessions s WHERE s.id = ${id} AND ${visible(sql, auth)}`;
    if (!s) throw new HTTPException(404, { message: "Session not found" });
    return c.json({ comments: await listComments(sql, id, 1000) });
  });

  app.post("/:id/comments", async (c) => {
    const auth = c.get("auth");
    const id = c.req.param("id");
    // Comments can be typed in the web app, so secrets are removed here too (with the org's own patterns).
    const parsed = parseBody(NewComment, await c.req.json());
    const [settings] = await sql`SELECT redaction_patterns FROM org_settings WHERE org_id = ${auth.orgId}`;
    const body = createRedactor(settings?.redaction_patterns ?? [])(parsed.body);
    const [s] = await sql`SELECT s.id FROM sessions s WHERE s.id = ${id} AND ${visible(sql, auth)}`;
    if (!s) throw new HTTPException(404, { message: "Session not found" });
    const commentId = newId("cm");
    await sql`
      INSERT INTO session_comments (id, session_id, org_id, author_id, body)
      VALUES (${commentId}, ${id}, ${auth.orgId}, ${auth.userId}, ${body})
    `;
    await audit(sql, auth, "session.comment", id, { comment: commentId });
    return c.json({ id: commentId }, 201);
  });

  /** Comment author, or an admin. */
  app.delete("/:id/comments/:commentId", async (c) => {
    const auth = c.get("auth");
    const { id, commentId } = c.req.param();
    const [row] = await sql`
      SELECT author_id FROM session_comments
      WHERE id = ${commentId} AND session_id = ${id} AND org_id = ${auth.orgId} AND deleted_at IS NULL
    `;
    if (!row) throw new HTTPException(404, { message: "Comment not found" });
    if (row.author_id !== auth.userId && auth.role === "member") {
      throw new HTTPException(403, { message: "Only the comment's author or an admin can delete it" });
    }
    await sql`UPDATE session_comments SET deleted_at = now(), body = '' WHERE id = ${commentId}`;
    await audit(sql, auth, "session.comment.delete", id, { comment: commentId });
    return c.json({ ok: true });
  });

  app.delete("/:id", async (c) => {
    const auth = c.get("auth");
    const id = c.req.param("id");
    const row = await loadOwned(sql, auth, id);
    await sql`UPDATE sessions SET deleted_at = now(), messages = '[]', transcript_key = NULL WHERE id = ${id}`;
    await sql`DELETE FROM session_comments WHERE session_id = ${id}`;
    if (row.transcript_key) await storage.delete(row.transcript_key);
    await audit(sql, auth, "session.delete", id);
    return c.json({ ok: true });
  });

  return app;
}

/** Live comments on a session, oldest first (the most recent `limit`). */
async function listComments(sql: Sql, sessionId: string, limit: number): Promise<Comment[]> {
  const rows = await sql`
    SELECT * FROM (
      SELECT c.id, c.body, c.created_at, u.id AS author_id, u.name AS author_name
      FROM session_comments c JOIN users u ON u.id = c.author_id
      WHERE c.session_id = ${sessionId} AND c.deleted_at IS NULL
      ORDER BY c.created_at DESC LIMIT ${limit}
    ) x ORDER BY created_at
  `;
  return rows.map((r) => ({ id: r.id, body: r.body, author: { id: r.author_id, name: r.author_name }, created_at: r.created_at.toISOString() }));
}

/** Deletes expired shares and their transcripts. Runs on an interval in the server process. */
export async function purgeExpired(sql: Sql, storage: BlobStorage): Promise<number> {
  const rows = await sql`
    WITH expired AS (
      SELECT id, transcript_key FROM sessions
      WHERE deleted_at IS NULL AND expires_at <= now()
      FOR UPDATE
    )
    UPDATE sessions s SET deleted_at = now(), messages = '[]', transcript_key = NULL
    FROM expired e WHERE s.id = e.id
    RETURNING e.transcript_key AS old_key
  `;
  for (const r of rows) if (r.old_key) await storage.delete(r.old_key);
  await sql`DELETE FROM session_comments c USING sessions s WHERE c.session_id = s.id AND s.deleted_at IS NOT NULL`;
  await purgeRateLimits(sql);
  return rows.length;
}
