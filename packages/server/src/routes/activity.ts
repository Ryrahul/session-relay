import { Hono } from "hono";
import type { Activity, Stats } from "@session-relay/shared";
import type { AppEnv } from "../auth.js";
import type { Sql } from "../db/client.js";
import { visible } from "./sessions.js";

const person = (id: string, name: string) => ({ id, name });

/** `?days=` between 1 and 90 (default `fallback`), as the start of that window. */
function window(raw: string | undefined, fallback: number): { days: number; since: Date } {
  const days = Math.min(Math.max(Math.trunc(Number(raw)) || fallback, 1), 90);
  return { days, since: new Date(Date.now() - days * 86400_000) };
}

export function activityRoutes(sql: Sql) {
  const app = new Hono<AppEnv>();

  /** Recent pickups and comments on sessions the caller can see. New shares come from GET /v1/sessions?since=. */
  app.get("/activity", async (c) => {
    const auth = c.get("auth");
    const { since } = window(c.req.query("days"), 1);
    const pickups = await sql`
      SELECT DISTINCT ON (l.user_id, l.target_id)
             s.id, s.title, s.author_id, sa.name AS author_name, l.user_id, u.name AS by_name, l.created_at
      FROM audit_log l
      JOIN sessions s ON s.id = l.target_id
      JOIN users u ON u.id = l.user_id
      JOIN users sa ON sa.id = s.author_id
      WHERE l.org_id = ${auth.orgId} AND l.action = 'session.pickup' AND l.created_at >= ${since} AND ${visible(sql, auth)}
      ORDER BY l.user_id, l.target_id, l.created_at DESC
    `;
    const comments = await sql`
      SELECT s.id, s.title, c.body, c.created_at, u.id AS author_id, u.name AS author_name
      FROM session_comments c JOIN sessions s ON s.id = c.session_id JOIN users u ON u.id = c.author_id
      WHERE c.org_id = ${auth.orgId} AND c.deleted_at IS NULL AND c.created_at >= ${since} AND ${visible(sql, auth)}
      ORDER BY c.created_at DESC LIMIT 100
    `;
    const body: Activity = {
      since: since.toISOString(),
      pickups: pickups
        .map((r) => ({
          session_id: r.id,
          session_title: r.title,
          session_author: person(r.author_id, r.author_name),
          by: person(r.user_id, r.by_name),
          at: r.created_at.toISOString(),
        }))
        .sort((a, b) => b.at.localeCompare(a.at)),
      comments: comments.map((r) => ({
        session_id: r.id,
        session_title: r.title,
        author: person(r.author_id, r.author_name),
        body: r.body,
        created_at: r.created_at.toISOString(),
      })),
    };
    return c.json(body);
  });

  app.get("/stats", async (c) => {
    const auth = c.get("auth");
    const { days, since } = window(c.req.query("days"), 30);
    const org = auth.orgId;

    const [totals] = await sql`
      SELECT
        (SELECT count(*)::int FROM sessions WHERE org_id = ${org} AND created_at >= ${since}) AS shares,
        (SELECT count(*)::int FROM sessions WHERE org_id = ${org} AND created_at >= ${since} AND continues_session_id IS NOT NULL) AS continued,
        (SELECT count(*)::int FROM (SELECT DISTINCT user_id, target_id FROM audit_log
           WHERE org_id = ${org} AND action = 'session.pickup' AND created_at >= ${since}) p) AS pickups,
        (SELECT count(*)::int FROM session_comments WHERE org_id = ${org} AND deleted_at IS NULL AND created_at >= ${since}) AS comments,
        (SELECT count(DISTINCT user_id)::int FROM audit_log
           WHERE org_id = ${org} AND action IN ('session.share', 'session.pickup', 'session.comment') AND created_at >= ${since}) AS active_people
    `;
    // Calendar days in UTC, including days with nothing.
    const byDay = await sql`
      SELECT to_char(d, 'YYYY-MM-DD') AS day,
        (SELECT count(*)::int FROM sessions WHERE org_id = ${org} AND created_at >= d AND created_at < d + interval '1 day') AS shares,
        (SELECT count(DISTINCT (user_id, target_id))::int FROM audit_log
           WHERE org_id = ${org} AND action = 'session.pickup' AND created_at >= d AND created_at < d + interval '1 day') AS pickups
      FROM generate_series(date_trunc('day', ${since}::timestamptz AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
                           date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC', interval '1 day') d
      ORDER BY d
    `;
    const byTool = await sql`
      SELECT source_tool AS tool, count(*)::int AS shares FROM sessions
      WHERE org_id = ${org} AND created_at >= ${since} GROUP BY 1 ORDER BY 2 DESC
    `;
    const byRepo = await sql`
      SELECT s.repo, count(*)::int AS shares FROM sessions s
      WHERE s.created_at >= ${since} AND ${visible(sql, auth)} GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 10
    `;
    const byPerson = await sql`
      SELECT u.id, u.name,
        (SELECT count(*)::int FROM sessions s WHERE s.org_id = ${org} AND s.author_id = u.id AND s.created_at >= ${since}) AS shares,
        (SELECT count(DISTINCT target_id)::int FROM audit_log l
           WHERE l.org_id = ${org} AND l.user_id = u.id AND l.action = 'session.pickup' AND l.created_at >= ${since}) AS pickups,
        (SELECT count(*)::int FROM session_comments c
           WHERE c.org_id = ${org} AND c.author_id = u.id AND c.deleted_at IS NULL AND c.created_at >= ${since}) AS comments
      FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.org_id = ${org}
      ORDER BY 3 DESC, 4 DESC, 5 DESC, u.name
    `;
    const body: Stats = {
      since: since.toISOString(),
      days,
      totals: totals as Stats["totals"],
      by_day: byDay as unknown as Stats["by_day"],
      by_tool: byTool as unknown as Stats["by_tool"],
      by_repo: byRepo as unknown as Stats["by_repo"],
      by_person: byPerson as unknown as Stats["by_person"],
    };
    return c.json(body);
  });

  return app;
}
