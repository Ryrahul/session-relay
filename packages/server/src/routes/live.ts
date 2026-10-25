import { Hono } from "hono";
import type { PendingQuery, Row } from "postgres";
import { HTTPException } from "hono/http-exception";
import {
  createRedactor,
  LIVE_LIMITS,
  LivePatch,
  LivePoll,
  LiveSend,
  LiveStart,
  newId,
  type LiveDetail,
  type LiveMessage,
  type LiveOverlap,
  type LivePollResult,
  type LiveSession,
} from "@session-relay/shared";
import type { AppEnv, AuthContext } from "../auth.js";
import { audit } from "../audit.js";
import type { Sql } from "../db/client.js";
import { iso, parseBody } from "../http.js";
import { repoAllowed } from "./sessions.js";

const MAX_THREAD = 200;

const state = (r: { ended_at: Date | null; heartbeat_at: Date }): LiveSession["state"] =>
  r.ended_at ? "ended" : Date.now() - r.heartbeat_at.getTime() > LIVE_LIMITS.awayMinutes * 60_000 ? "away" : "live";

/** Live sessions with their owner, recent files and unread count. */
async function loadLive(sql: Sql, orgId: string, where: PendingQuery<Row[]>): Promise<LiveSession[]> {
  const rows = await sql`
    SELECT l.*, u.name AS owner_name,
      (SELECT count(*)::int FROM live_messages m WHERE m.to_live_id = l.id AND m.id > l.read_upto) AS unread,
      (SELECT coalesce(json_agg(json_build_object('path', f.path, 'at', f.touched_at) ORDER BY f.touched_at DESC), '[]')
         FROM (SELECT * FROM live_files WHERE live_id = l.id ORDER BY touched_at DESC LIMIT 10) f) AS files
    FROM live_sessions l JOIN users u ON u.id = l.user_id
    WHERE l.org_id = ${orgId} AND ${where}
    ORDER BY l.heartbeat_at DESC
  `;
  return rows.map((r) => ({
    id: r.id,
    owner: { id: r.user_id, name: r.owner_name },
    repo: r.repo,
    branch: r.branch,
    tool: r.source_tool,
    title: r.title,
    status: r.status,
    autonomy: r.autonomy,
    started_at: r.started_at.toISOString(),
    heartbeat_at: r.heartbeat_at.toISOString(),
    ended_at: iso(r.ended_at),
    state: state(r as { ended_at: Date | null; heartbeat_at: Date }),
    files: (r.files as { path: string; at: string }[]).map((f) => ({ path: f.path, at: new Date(f.at).toISOString() })),
    unread: r.unread,
  }));
}

const toMessage = (r: Record<string, any>): LiveMessage => ({
  id: Number(r.id),
  to_live: r.to_live_id,
  from_live: r.from_live_id,
  from: { id: r.from_user_id, name: r.from_name },
  from_agent: r.from_agent,
  to: { id: r.to_user_id, name: r.to_name },
  kind: r.kind,
  body: r.body,
  reply_to: r.reply_to === null ? null : Number(r.reply_to),
  created_at: r.created_at.toISOString(),
  read: Number(r.id) <= Number(r.read_upto),
});

const MESSAGE_COLUMNS = (sql: Sql) => sql`
  m.*, fu.name AS from_name, t.user_id AS to_user_id, tu.name AS to_name, t.read_upto
`;
const MESSAGE_JOINS = (sql: Sql) => sql`
  JOIN live_sessions t ON t.id = m.to_live_id
  JOIN users fu ON fu.id = m.from_user_id
  JOIN users tu ON tu.id = t.user_id
`;

async function loadOwn(sql: Sql, auth: AuthContext, id: string, allowAdmin = false) {
  const [row] = await sql`SELECT * FROM live_sessions WHERE id = ${id} AND org_id = ${auth.orgId}`;
  if (!row) throw new HTTPException(404, { message: "Live session not found" });
  if (row.user_id !== auth.userId && !(allowAdmin && auth.role !== "member")) {
    throw new HTTPException(403, { message: "Only the person working in this live session can do that" });
  }
  return row;
}

export function liveRoutes(sql: Sql) {
  const app = new Hono<AppEnv>();

  /** Who is working live right now (`?ended=1` adds sessions ended in the last day). */
  app.get("/", async (c) => {
    const auth = c.get("auth");
    const withEnded = c.req.query("ended") === "1";
    const where = withEnded
      ? sql`(l.ended_at IS NULL OR l.ended_at > now() - interval '1 day')`
      : sql`l.ended_at IS NULL`;
    return c.json({ live: await loadLive(sql, auth.orgId, where) });
  });

  app.post("/", async (c) => {
    const auth = c.get("auth");
    const body = parseBody(LiveStart, await c.req.json());
    const [settings] = await sql`SELECT repo_allowlist, live_autonomy FROM org_settings WHERE org_id = ${auth.orgId}`;
    if (!repoAllowed(settings!.repo_allowlist, body.repo)) throw new HTTPException(403, { message: `Repo ${body.repo} is not on this org's allowlist` });
    if (body.autonomy && !settings!.live_autonomy) {
      throw new HTTPException(403, { message: "Your org's admins turned off letting agents act on teammates' messages without asking" });
    }
    const [counts] = await sql`
      SELECT count(*) FILTER (WHERE user_id = ${auth.userId})::int AS mine, count(*)::int AS org
      FROM live_sessions WHERE org_id = ${auth.orgId} AND ended_at IS NULL
    `;
    if (counts!.mine >= LIVE_LIMITS.perUser) {
      throw new HTTPException(429, { message: `You already have ${LIVE_LIMITS.perUser} live sessions open. End one first (relay live stop).` });
    }
    if (counts!.org >= LIVE_LIMITS.perOrg) throw new HTTPException(429, { message: "Too many live sessions open in this org" });
    const id = newId("lv");
    await sql`
      INSERT INTO live_sessions (id, org_id, user_id, repo, branch, source_tool, title, autonomy)
      VALUES (${id}, ${auth.orgId}, ${auth.userId}, ${body.repo}, ${body.branch ?? null}, ${body.tool ?? null}, ${body.title ?? ""}, ${body.autonomy})
    `;
    await audit(sql, auth, "live.start", id, { repo: body.repo, autonomy: body.autonomy });
    return c.json({ id }, 201);
  });

  app.post("/messages", async (c) => {
    const auth = c.get("auth");
    const m = parseBody(LiveSend, await c.req.json());

    let from: Record<string, any> | null = null;
    if (m.from_live) {
      [from = null] = await sql<Record<string, any>[]>`SELECT * FROM live_sessions WHERE id = ${m.from_live} AND org_id = ${auth.orgId} AND user_id = ${auth.userId}`;
      if (!from) throw new HTTPException(400, { message: "from_live is not one of your live sessions" });
      if (from.ended_at) throw new HTTPException(400, { message: "Your live session has ended" });
    }

    const [sent] = await sql`
      SELECT count(*)::int AS n FROM live_messages WHERE from_user_id = ${auth.userId} AND created_at > now() - interval '1 minute'
    `;
    if (sent!.n >= LIVE_LIMITS.sendPerMinute) throw new HTTPException(429, { message: "Too many messages in the last minute. Slow down." });

    // Who gets it: one live session, someone's live sessions, or everyone live in a repo.
    let targets: Record<string, any>[];
    if (m.to_live) {
      targets = await sql`SELECT * FROM live_sessions WHERE id = ${m.to_live} AND org_id = ${auth.orgId} AND ended_at IS NULL`;
      if (!targets.length) throw new HTTPException(404, { message: "That live session has ended or doesn't exist" });
    } else if (m.to_user) {
      const [member] = await sql`
        SELECT u.name FROM memberships ms JOIN users u ON u.id = ms.user_id WHERE ms.org_id = ${auth.orgId} AND ms.user_id = ${m.to_user}
      `;
      if (!member) throw new HTTPException(400, { message: "Not a member of this org" });
      const theirs = await sql`
        SELECT * FROM live_sessions WHERE org_id = ${auth.orgId} AND user_id = ${m.to_user} AND ended_at IS NULL ORDER BY heartbeat_at DESC
      `;
      const sameRepo = from ? theirs.filter((t) => t.repo === from!.repo) : [];
      targets = sameRepo.length ? sameRepo : [...theirs];
      if (!targets.length) {
        throw new HTTPException(409, {
          message: `${member.name} isn't working live right now. They can start with /live; until then, leave a comment on their shared session.`,
        });
      }
    } else {
      targets = await sql`
        SELECT * FROM live_sessions WHERE org_id = ${auth.orgId} AND repo = ${m.to_repo!} AND ended_at IS NULL AND user_id <> ${auth.userId}
      `;
      if (!targets.length) throw new HTTPException(409, { message: `Nobody else is working live in ${m.to_repo}` });
    }
    targets = targets.filter((t) => t.id !== m.from_live);
    if (!targets.length) throw new HTTPException(400, { message: "You can't send a message to your own live session" });

    if (m.reply_to) {
      const [orig] = await sql`SELECT 1 FROM live_messages WHERE id = ${m.reply_to} AND org_id = ${auth.orgId}`;
      if (!orig) throw new HTTPException(400, { message: `Message #${m.reply_to} not found` });
    }

    const [settings] = await sql`SELECT redaction_patterns FROM org_settings WHERE org_id = ${auth.orgId}`;
    const body = createRedactor(settings?.redaction_patterns ?? [])(m.body);

    const ids: number[] = [];
    const skipped: string[] = [];
    for (const t of targets) {
      const [inbox] = await sql`SELECT count(*)::int AS n FROM live_messages WHERE to_live_id = ${t.id}`;
      if (inbox!.n >= LIVE_LIMITS.inboxMax) {
        skipped.push(`${t.id} (inbox full)`);
        continue;
      }
      if (m.from_agent) {
        // Two agents can't keep a conversation going on their own: after a run of agent-written
        // messages between the same two people, a person has to send one (web app or relay live send).
        const recent = await sql`
          SELECT x.from_agent FROM live_messages x JOIN live_sessions xt ON xt.id = x.to_live_id
          WHERE x.org_id = ${auth.orgId} AND x.created_at > now() - interval '30 minutes'
            AND ((x.from_user_id = ${auth.userId} AND xt.user_id = ${t.user_id}) OR (x.from_user_id = ${t.user_id} AND xt.user_id = ${auth.userId}))
          ORDER BY x.id DESC LIMIT ${LIVE_LIMITS.agentStreak}
        `;
        if (recent.length >= LIVE_LIMITS.agentStreak && recent.every((r) => r.from_agent)) {
          throw new HTTPException(429, {
            message: `Paused: your agents exchanged ${LIVE_LIMITS.agentStreak} messages in a row without a person. One of you has to reply yourself (web app → Live, or relay live send) before agents can continue.`,
          });
        }
      }
      const [row] = await sql`
        INSERT INTO live_messages (org_id, to_live_id, from_live_id, from_user_id, from_agent, kind, body, reply_to)
        VALUES (${auth.orgId}, ${t.id}, ${m.from_live ?? null}, ${auth.userId}, ${m.from_agent}, ${m.kind}, ${body}, ${m.reply_to ?? null})
        RETURNING id
      `;
      ids.push(Number(row!.id));
    }
    if (!ids.length) throw new HTTPException(429, { message: `Not delivered: ${skipped.join(", ")}` });
    if (from) await sql`UPDATE live_sessions SET heartbeat_at = now() WHERE id = ${from.id}`;
    await audit(sql, auth, "live.message", targets[0]!.id, { kind: m.kind, to: targets.length, agent: m.from_agent });
    const names = await sql`SELECT DISTINCT u.name FROM users u WHERE u.id IN ${sql(targets.map((t) => t.user_id))}`;
    return c.json({ ids, delivered_to: targets.length - skipped.length, people: names.map((n) => n.name), skipped }, 201);
  });

  /** A live session with its messages. Messages are only shown to the two people involved. */
  app.get("/:id", async (c) => {
    const auth = c.get("auth");
    const id = c.req.param("id");
    const [live] = await loadLive(sql, auth.orgId, sql`l.id = ${id}`);
    if (!live) throw new HTTPException(404, { message: "Live session not found" });
    const rows = await sql`
      SELECT * FROM (
        SELECT ${MESSAGE_COLUMNS(sql)} FROM live_messages m ${MESSAGE_JOINS(sql)}
        WHERE (m.to_live_id = ${id} OR m.from_live_id = ${id})
          AND (m.from_user_id = ${auth.userId} OR t.user_id = ${auth.userId})
        ORDER BY m.id DESC LIMIT ${MAX_THREAD}
      ) x ORDER BY id
    `;
    const body: LiveDetail = { ...live, messages: rows.map(toMessage) };
    return c.json(body);
  });

  app.patch("/:id", async (c) => {
    const auth = c.get("auth");
    const id = c.req.param("id");
    const patch = parseBody(LivePatch, await c.req.json());
    const row = await loadOwn(sql, auth, id);
    if (row.ended_at) throw new HTTPException(409, { message: "This live session has ended" });
    if (patch.autonomy) {
      const [s] = await sql`SELECT live_autonomy FROM org_settings WHERE org_id = ${auth.orgId}`;
      if (!s!.live_autonomy) throw new HTTPException(403, { message: "Your org's admins turned off letting agents act on teammates' messages without asking" });
    }
    await sql`
      UPDATE live_sessions SET
        title = ${patch.title ?? row.title},
        status = ${patch.status ?? row.status},
        branch = ${patch.branch ?? row.branch},
        autonomy = ${patch.autonomy ?? row.autonomy},
        heartbeat_at = now()
      WHERE id = ${id}
    `;
    if (patch.autonomy !== undefined && patch.autonomy !== row.autonomy) await audit(sql, auth, "live.update", id, { autonomy: patch.autonomy });
    return c.json({ ok: true });
  });

  /** End a live session: its owner, or an admin. */
  app.post("/:id/end", async (c) => {
    const auth = c.get("auth");
    const id = c.req.param("id");
    const row = await loadOwn(sql, auth, id, true);
    if (!row.ended_at) {
      await sql`UPDATE live_sessions SET ended_at = now() WHERE id = ${id}`;
      await audit(sql, auth, "live.end", id);
    }
    return c.json({ ok: true });
  });

  /** Mark everything up to `upto` as read, without taking it through a poll (the owner reading in the web app). */
  app.post("/:id/read", async (c) => {
    const auth = c.get("auth");
    const id = c.req.param("id");
    await loadOwn(sql, auth, id);
    const upto = Number((await c.req.json().catch(() => ({}))).upto) || Number.MAX_SAFE_INTEGER;
    await sql`
      UPDATE live_sessions SET read_upto = greatest(read_upto, (SELECT coalesce(max(id), 0) FROM live_messages WHERE to_live_id = ${id} AND id <= ${upto}))
      WHERE id = ${id}
    `;
    return c.json({ ok: true });
  });

  /**
   * Called by the owner's agent between steps (hooks) or tools: heartbeat, files being edited,
   * unread messages (marked read unless ack is false) and overlaps with teammates' files.
   */
  app.post("/:id/poll", async (c) => {
    const auth = c.get("auth");
    const id = c.req.param("id");
    const p = parseBody(LivePoll, await c.req.json().catch(() => ({})));
    const row = await loadOwn(sql, auth, id);
    if (row.ended_at) {
      const body: LivePollResult = { messages: [], more: false, overlaps: [], autonomy: false, ended: true };
      return c.json(body);
    }
    await sql`UPDATE live_sessions SET heartbeat_at = now() ${p.status ? sql`, status = ${p.status}` : sql``} WHERE id = ${id}`;

    const files = [...new Set(p.files.map((f) => f.replace(/\\/g, "/").replace(/^\.\//, "")))];
    let overlaps: LiveOverlap[] = [];
    if (files.length) {
      await sql`
        INSERT INTO live_files ${sql(files.map((path) => ({ live_id: id, path })))}
        ON CONFLICT (live_id, path) DO UPDATE SET touched_at = now()
      `;
      await sql`
        DELETE FROM live_files WHERE live_id = ${id} AND path NOT IN (
          SELECT path FROM live_files WHERE live_id = ${id} ORDER BY touched_at DESC LIMIT ${LIVE_LIMITS.filesMax}
        )
      `;
      const rows = await sql`
        SELECT f.path, f.touched_at, l.id AS live_id, l.branch, u.id AS user_id, u.name
        FROM live_files f JOIN live_sessions l ON l.id = f.live_id JOIN users u ON u.id = l.user_id
        WHERE l.org_id = ${auth.orgId} AND l.repo = ${row.repo} AND l.ended_at IS NULL AND l.user_id <> ${auth.userId}
          AND f.path IN ${sql(files)} AND f.touched_at > now() - make_interval(mins => ${LIVE_LIMITS.overlapMinutes})
        ORDER BY f.touched_at DESC
      `;
      overlaps = rows.map((r) => ({
        path: r.path,
        live_id: r.live_id,
        owner: { id: r.user_id, name: r.name },
        branch: r.branch,
        at: r.touched_at.toISOString(),
      }));
    }

    const rows = await sql`
      SELECT ${MESSAGE_COLUMNS(sql)} FROM live_messages m ${MESSAGE_JOINS(sql)}
      WHERE m.to_live_id = ${id} AND m.id > ${row.read_upto}
      ORDER BY m.id LIMIT ${LIVE_LIMITS.pollBatch + 1}
    `;
    const more = rows.length > LIVE_LIMITS.pollBatch;
    const batch = rows.slice(0, LIVE_LIMITS.pollBatch);
    if (p.ack && batch.length) {
      await sql`UPDATE live_sessions SET read_upto = greatest(read_upto, ${batch[batch.length - 1]!.id}) WHERE id = ${id}`;
    }
    const body: LivePollResult = {
      messages: batch.map((r) => ({ ...toMessage(r), read: p.ack })),
      more,
      overlaps,
      autonomy: row.autonomy,
      ended: false,
    };
    return c.json(body);
  });

  return app;
}

/** Ends live sessions nobody has touched for 12 hours and deletes ones ended a week ago. */
export async function purgeLive(sql: Sql): Promise<void> {
  await sql`
    UPDATE live_sessions SET ended_at = now()
    WHERE ended_at IS NULL AND heartbeat_at < now() - make_interval(hours => ${LIVE_LIMITS.endAfterHours})
  `;
  await sql`DELETE FROM live_sessions WHERE ended_at < now() - make_interval(days => ${LIVE_LIMITS.keepDays})`;
  await sql`DELETE FROM live_files WHERE touched_at < now() - interval '1 day'`;
}
