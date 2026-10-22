import { gunzipSync, gzipSync } from "node:zlib";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  DetailMode,
  newId,
  SessionPatch,
  ShareRequest,
  type Message,
  type SessionDetail,
  type SessionListItem,
} from "@session-relay/shared";
import type { AppEnv, AuthContext } from "../auth.js";
import { audit, recordUsage } from "../audit.js";
import type { Sql } from "../db/client.js";
import { iso, parseBody } from "../http.js";
import { transcriptKey, type BlobStorage } from "../storage/index.js";

const MAX_LIST = 100;
const FULL_PAGE = 200;

/** Rows the caller may see: same org, live, and either team-visible, theirs, or shared with them. */
function visible(sql: Sql, auth: AuthContext) {
  return sql`
    s.org_id = ${auth.orgId}
    AND s.deleted_at IS NULL
    AND (s.expires_at IS NULL OR s.expires_at > now())
    AND (
      s.visibility_team
      OR s.author_id = ${auth.userId}
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

function repoAllowed(allowlist: string[], repo: string): boolean {
  return allowlist.length === 0 || allowlist.some((a) => repo === a || (a.endsWith("/*") && repo.startsWith(a.slice(0, -1))));
}

export function sessionRoutes(sql: Sql, storage: BlobStorage) {
  const app = new Hono<AppEnv>();

  app.post("/", async (c) => {
    const auth = c.get("auth");
    const { session: s, transcript } = parseBody(ShareRequest, await c.req.json());

    const [settings] = await sql`SELECT retention_days, repo_allowlist FROM org_settings WHERE org_id = ${auth.orgId}`;
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
            transcript_key, transcript_bytes, started_at, expires_at
          ) VALUES (
            ${id}, ${auth.orgId}, ${auth.userId}, ${s.source.tool}, ${s.source.version ?? null}, ${s.source.native_id},
            ${s.repo}, ${s.branch ?? null}, ${s.commit ?? null}, ${s.title}, ${tx.json(s.summary)},
            ${s.files_touched}, ${tx.json(messages)}, ${s.include}, ${s.visibility.team}, ${s.redactions},
            ${key}, ${blob?.byteLength ?? null}, ${s.started_at ?? null},
            now() + make_interval(days => ${settings!.retention_days})
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
    await audit(sql, auth, "session.share", id, { repo: s.repo, include: s.include, team: s.visibility.team });
    return c.json({ id }, 201);
  });

  app.get("/", async (c) => {
    const auth = c.get("auth");
    const q = c.req.query();
    const limit = Math.min(Number(q.limit) || 20, MAX_LIST);
    const author = q.author === "me" ? auth.userId : q.author;

    const rows = await sql`
      SELECT s.id, s.title, s.repo, s.branch, s.source_tool, s.summary->>'goal' AS goal, s.include_mode,
             jsonb_array_length(s.messages) AS message_count, s.transcript_key IS NOT NULL AS has_full,
             s.visibility_team, s.created_at, u.id AS author_id, u.name AS author_name
             ${q.q ? sql`, ts_rank(s.search, websearch_to_tsquery('english', ${q.q})) AS rank` : sql``}
      FROM sessions s JOIN users u ON u.id = s.author_id
      WHERE ${visible(sql, auth)}
        ${q.repo ? sql`AND s.repo = ${q.repo}` : sql``}
        ${q.branch ? sql`AND s.branch = ${q.branch}` : sql``}
        ${q.tool ? sql`AND s.source_tool = ${q.tool}` : sql``}
        ${author ? sql`AND (u.id = ${author} OR u.name ILIKE ${"%" + author + "%"} OR u.email ILIKE ${author + "%"})` : sql``}
        ${q.q ? sql`AND (s.search @@ websearch_to_tsquery('english', ${q.q}) OR s.title ILIKE ${"%" + q.q + "%"})` : sql``}
        ${q.before ? sql`AND s.created_at < ${q.before}` : sql``}
      ORDER BY ${q.q ? sql`rank DESC,` : sql``} s.created_at DESC
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
      created_at: r.created_at.toISOString(),
    }));
    return c.json({ sessions });
  });

  app.get("/:id", async (c) => {
    const auth = c.get("auth");
    const id = c.req.param("id");
    const mode = DetailMode.catch("tail").parse(c.req.query("mode") ?? "tail");
    const [r] = await sql`
      SELECT s.*, u.name AS author_name
      FROM sessions s JOIN users u ON u.id = s.author_id
      WHERE s.id = ${id} AND ${visible(sql, auth)}
    `;
    if (!r) throw new HTTPException(404, { message: "Session not found" });

    let all: Message[] = r.messages;
    if (mode === "full" && r.transcript_key) {
      const blob = await storage.get(r.transcript_key);
      if (blob) all = JSON.parse(gunzipSync(blob).toString("utf8"));
    }
    let window: Message[] = [];
    let offset = 0;
    if (mode === "tail") {
      const tail = Math.max(1, Number(c.req.query("tail")) || all.length);
      offset = Math.max(0, all.length - tail);
      window = all.slice(offset);
    } else if (mode === "full") {
      offset = Math.max(0, Number(c.req.query("offset")) || 0);
      const limit = Math.min(Number(c.req.query("limit")) || FULL_PAGE, 1000);
      window = all.slice(offset, offset + limit);
    }

    const people = await sql`
      SELECT u.id, u.name FROM session_people p JOIN users u ON u.id = p.user_id WHERE p.session_id = ${id}
    `;
    await recordUsage(sql, auth, `session.get.${mode}`);
    if (mode !== "summary") await audit(sql, auth, "session.pull", id, { mode });

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
    };
    return c.json(body);
  });

  app.patch("/:id", async (c) => {
    const auth = c.get("auth");
    const id = c.req.param("id");
    const patch = parseBody(SessionPatch, await c.req.json());
    await loadOwned(sql, auth, id);
    await sql.begin(async (tx) => {
      if (patch.title) await tx`UPDATE sessions SET title = ${patch.title} WHERE id = ${id}`;
      if (patch.visibility) {
        await tx`UPDATE sessions SET visibility_team = ${patch.visibility.team} WHERE id = ${id}`;
        await setPeople(tx as unknown as Sql, auth.orgId, id, patch.visibility.team ? [] : patch.visibility.people);
      }
    });
    await audit(sql, auth, "session.update", id, patch as Record<string, unknown>);
    return c.json({ ok: true });
  });

  app.delete("/:id", async (c) => {
    const auth = c.get("auth");
    const id = c.req.param("id");
    const row = await loadOwned(sql, auth, id);
    await sql`UPDATE sessions SET deleted_at = now(), messages = '[]', transcript_key = NULL WHERE id = ${id}`;
    if (row.transcript_key) await storage.delete(row.transcript_key);
    await audit(sql, auth, "session.delete", id);
    return c.json({ ok: true });
  });

  return app;
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
  return rows.length;
}
