// Builds db.sqlite: ZCode's real session tables (schema.sql) filled with the OpenCode fixture
// session, since ZCode stores messages and parts in the same format. Run: node fixtures/zcode/build.mjs
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";

const dir = new URL(".", import.meta.url).pathname;
const db = dir + "db.sqlite";
const data = JSON.parse(readFileSync(dir + "../opencode/fix-add.export.json", "utf8"));
const q = (v) => (v == null ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

const s = data.info;
const id = "ses_zc01fixadd";
const sql = [readFileSync(dir + "schema.sql", "utf8")];
const session = (sid, extra) =>
  sql.push(
    `INSERT INTO session (id, project_id, parent_id, slug, directory, title, version, time_created, time_updated, time_archived) VALUES (` +
      [sid, s.projectID, extra.parent, s.slug, extra.dir ?? s.directory, extra.title, "0.32.1", s.time.created, extra.updated, extra.archived].map(q).join(", ") +
      ");",
  );
session(id, { title: s.title, updated: s.time.updated });
session("ses_zc02other", { title: "Other repo", dir: "/home/dev/other", updated: s.time.updated + 1 });
session("ses_zc03child", { title: "Subagent", parent: id, updated: s.time.updated + 2 });
session("ses_zc04old", { title: "Archived", updated: s.time.updated + 3, archived: s.time.updated + 3 });

data.messages.forEach((m, i) => {
  const { id: mid, sessionID: _s, ...info } = m.info;
  const t = info.time?.created ?? s.time.created;
  sql.push(`INSERT INTO message (id, session_id, time_created, time_updated, data, sequence) VALUES (${[mid, id, t, t, JSON.stringify(info), i].map(q).join(", ")});`);
  m.parts.forEach((p, j) => {
    const { id: pid, sessionID: _ps, messageID: _pm, ...part } = p;
    sql.push(`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data, sequence) VALUES (${[pid, mid, id, t, t, JSON.stringify(part), j].map(q).join(", ")});`);
  });
});

rmSync(db, { force: true });
execFileSync("sqlite3", [db], { input: sql.join("\n") });
console.log(`wrote ${db}`);
