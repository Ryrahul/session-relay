// Builds the public website from docs/*.md: a landing page plus one page per doc.
//   node site/build.mjs [outDir]                       site for https://relay.rahulweb.online (default site/dist)
//   node site/build.mjs <outDir> --redirect-to <url>   same paths, each redirecting to <url> (old GitHub Pages address)
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const flag = args.indexOf("--redirect-to");
const REDIRECT_TO = flag >= 0 ? args[flag + 1]?.replace(/\/$/, "") : null;
const positional = args.filter((a, i) => !a.startsWith("--") && (flag < 0 || i !== flag + 1));
const OUT = path.resolve(positional[0] ?? path.join(ROOT, "site/dist"));
const REPO = "https://github.com/Ryrahul/session-relay";
const SITE_URL = (process.env.SITE_URL ?? "https://relay.rahulweb.online").replace(/\/$/, "");

// Order and titles for the docs nav. Files not listed are still built.
const NAV = [
  ["getting-started", "Getting started"],
  ["features", "Features"],
  ["self-hosting", "Self-hosting"],
  ["cloudflare", "Deploy to Cloudflare"],
  ["agents", "Agents"],
  ["cli", "CLI reference"],
  ["security", "Security & privacy"],
  ["faq", "FAQ"],
  ["roadmap", "Roadmap"],
  ["deploy-pipeline", "Continuous deployment"],
];

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** Links between docs point at the built pages; links into the code point at GitHub. */
function rewriteLinks(html, depth) {
  const up = "../".repeat(depth);
  return html
    .replace(/href="(?:\.\/)?(?:docs\/)?([\w-]+)\.md(#[^"]*)?"/g, (_, name, hash = "") =>
      name === "README" ? `href="${up}docs/"` : `href="${up}docs/${name}.html${hash}"`)
    .replace(/href="\.\.\/((?:packages|deploy|scripts|fixtures)\/[^"]+)"/g, `href="${REPO}/blob/main/$1"`)
    .replace(/src="(?:docs\/)?images\//g, `src="${up}images/`);
}

function slugify(text) {
  return text.toLowerCase().replace(/<[^>]+>/g, "").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "");
}

const renderer = new marked.Renderer();
renderer.heading = function ({ tokens, depth }) {
  const text = this.parser.parseInline(tokens);
  const id = slugify(text);
  return depth === 1 ? `<h1>${text}</h1>` : `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true">#</a>${text}</h${depth}>`;
};
renderer.table = function (token) {
  return `<div class="table-wrap">${marked.Renderer.prototype.table.call(this, token)}</div>`;
};
marked.use({ renderer, gfm: true });

const GITHUB_ICON = `<svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>`;

const MARK = `<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="5" width="13" height="5" rx="2.5" fill="var(--accent)"/><rect x="9" y="14" width="13" height="5" rx="2.5" fill="var(--ink)" opacity="0.85"/></svg>`;
const FAVICON = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect x='2' y='5' width='13' height='5' rx='2.5' fill='%230f7b6c'/%3E%3Crect x='9' y='14' width='13' height='5' rx='2.5' fill='%2316202b'/%3E%3C/svg%3E`;

function page({ title, description, body, depth, active = "", urlPath = "/" }) {
  const up = "../".repeat(depth);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<link rel="canonical" href="${SITE_URL}${urlPath}">
<meta property="og:url" content="${SITE_URL}${urlPath}">
<link rel="icon" href="${FAVICON}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<link rel="stylesheet" href="${up}site.css">
</head>
<body>
<header class="top">
  <div class="top-inner">
    <a class="brand" href="${up}index.html">${MARK}<span>Session Relay</span></a>
    <nav aria-label="Site">
      <a href="${up}docs/getting-started.html"${active === "docs" ? ' aria-current="page"' : ""}>Docs</a>
      <a href="${up}docs/self-hosting.html">Self-host</a>
      <a href="${up}index.html#hosting">Cloud</a>
      <a href="${REPO}" class="nav-github">${GITHUB_ICON}<span>GitHub</span></a>
    </nav>
  </div>
</header>
${body}
<footer class="foot">
  <div class="foot-inner">
    <span>Session Relay</span>
    <span class="faint">Share coding-agent sessions across Claude Code, Codex, OpenCode, Gemini CLI, Copilot CLI, Cursor and ZCode.</span>
    <a href="${REPO}">GitHub</a>
  </div>
</footer>
</body>
</html>
`;
}

function landing() {
  const body = `
<main class="landing">
  <section class="hero">
    <p class="eyebrow">For teams using Claude Code, Codex, OpenCode, Gemini CLI, Copilot CLI, Cursor and ZCode</p>
    <h1>Pick up where your teammate left off.</h1>
    <p class="lede">Share a coding-agent session with one command. Your teammate continues it in whichever agent they use, with the goal, the decisions, the next steps and the recent conversation.</p>
    <div class="cta">
      <a class="btn btn-primary" href="docs/self-hosting.html">Self-host it</a>
      <a class="btn btn-github" href="${REPO}">${GITHUB_ICON}<span>View on GitHub</span></a>
      <a class="btn" href="docs/getting-started.html">Read the docs</a>
    </div>
    <p class="hero-install"><code>npm install -g session-relay</code></p>
    <div class="handoff" aria-label="Example: share in Claude Code, pick up in OpenCode">
      <div class="term">
        <div class="term-bar"><span class="tool claude">Claude Code</span><span class="faint">Alice</span></div>
        <pre><span class="prompt">&gt;</span> /share
<span class="faint">⎿ relay · share_current_session</span>
Shared as <b>rs_P3AC0X4Y</b>: "Make Stripe webhooks
idempotent with retries" (summary + 30 messages,
whole team). Removed 2 secrets.</pre>
      </div>
      <div class="baton" aria-hidden="true">${MARK}</div>
      <div class="term">
        <div class="term-bar"><span class="tool opencode">OpenCode</span><span class="faint">Bob</span></div>
        <pre><span class="prompt">&gt;</span> /pickup alice's webhook work
<span class="faint">⎿ relay · get_session rs_P3AC0X4Y</span>
Alice made the handler idempotent and moved
processing to the queue. Next: load-test the
retry path. Starting with that now.</pre>
      </div>
    </div>
  </section>

  <section class="shot">
    <picture>
      <source srcset="images/session-dark.png" media="(prefers-color-scheme: dark)">
      <img src="images/session.png" alt="A shared session in the Session Relay web app: goal, next steps, decisions, conversation and details" width="2720" height="1720" loading="lazy">
    </picture>
  </section>

  <section class="how">
    <h2>How it works</h2>
    <ol class="how-steps">
      <li><h3>Share</h3><p>Run <code>/share</code> in your agent. It writes a handoff (goal, decisions, done, next steps, open questions) and shares it with the last 30 messages and the files touched. Secrets are removed on your laptop first.</p></li>
      <li><h3>Find</h3><p>Everything your team shares is in one place. Search it from the web app, the <code>relay</code> CLI, or straight from your agent.</p></li>
      <li><h3>Pick up</h3><p>Run <code>/pickup</code>. The agent reads the handoff, checks the current code, tells you where things stand and continues, in any of the four agents.</p></li>
    </ol>
  </section>

  <section class="features">
    <div>
      <h3>Works across agents</h3>
      <p>Start in Claude Code, finish in Codex, OpenCode, Gemini CLI, Copilot CLI, Cursor or ZCode. Each tool's sessions are read in its own format and turned into one handoff any agent understands.</p>
    </div>
    <div>
      <h3>Private by default</h3>
      <p>Nothing leaves your laptop unless you share it. API keys, tokens, passwords and private keys are removed before upload. Share with the whole team or specific people.</p>
    </div>
    <div>
      <h3>Built for teams</h3>
      <p>Organizations, roles, handoff templates per repo, retention, a repo allowlist, your own secret patterns and an audit log. An Activity digest and Stats show who shares and who picks up.</p>
    </div>
    <div>
      <h3>Handoff chains</h3>
      <p>Pick up a session and share your work later: it's linked automatically. Every session shows the trail. Forget to share? Auto-share keeps a private draft of each session for you to publish.</p>
    </div>
    <div>
      <h3>Easy onboarding</h3>
      <p>Invite teammates with a single-use link. <code>relay login</code> signs in by approving a code in the browser, with no tokens to copy around.</p>
    </div>
    <div>
      <h3>Handoffs for someone</h3>
      <p>Share "for Akshat" and it shows up as <b>For you</b> in their list; <code>/pickup</code> checks their handoffs first. Edit a share any time, and leave comments the next agent reads.</p>
    </div>
    <div>
      <h3>Linked to your PRs</h3>
      <p>Shares pick up the branch's open pull request automatically. Find every session that touched a file with <code>file:src/billing.ts</code>.</p>
    </div>
    <div>
      <h3>Small to run</h3>
      <p>One container plus Postgres with automatic HTTPS, or Cloudflare Workers with no server at all. Upgrades are a <code>git pull</code> and a restart.</p>
    </div>
  </section>

  <section class="hosting" id="hosting">
    <h2>Hosting</h2>
    <div class="plans">
      <div class="plan">
        <div class="plan-head"><h3>Self-hosted</h3><span class="pill pill-on">Available now</span></div>
        <p>Run it on your own server with Docker, or on your own Cloudflare account with no server at all. Your sessions stay in your infrastructure.</p>
        <ul>
          <li>One <code>docker compose up</code>, HTTPS included</li>
          <li>Or <code>wrangler deploy</code> to Cloudflare Workers</li>
          <li>All features: web app, CLI, agents, roles</li>
          <li>Backups are a single <code>pg_dump</code></li>
        </ul>
        <div class="row-btns"><a class="btn btn-primary" href="docs/self-hosting.html">Docker guide</a><a class="btn" href="docs/cloudflare.html">Cloudflare guide</a></div>
      </div>
      <div class="plan plan-soon">
        <div class="plan-head"><h3>Cloud</h3><span class="pill">Coming soon</span></div>
        <p>We run it for you. No server to set up or maintain.</p>
        <ul>
          <li>Sign in with GitHub or Google</li>
          <li>Invite your team by email</li>
          <li>Same CLI, agents and web app</li>
        </ul>
        <a class="btn" href="${REPO}">Watch on GitHub for updates</a>
      </div>
    </div>
  </section>

  <section class="start">
    <h2>Try it</h2>
    <pre class="code"><code><span class="faint"># on a server, once per team</span>
git clone ${REPO}.git &amp;&amp; cd session-relay
cp deploy/.env.example deploy/.env    <span class="faint"># set password, URL, domain</span>
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build

<span class="faint"># on each laptop</span>
npm install -g session-relay
relay login --server https://relay.your-team.com   <span class="faint"># approve in the browser</span>
relay setup                           <span class="faint"># adds /share and /pickup to your agents</span></code></pre>
    <p><a href="docs/getting-started.html">Full getting-started guide →</a></p>
  </section>

  <section class="oss">
    <a class="oss-card" href="${REPO}">
      ${GITHUB_ICON}
      <div>
        <h3>Open source on GitHub</h3>
        <p>AGPL-3.0. Read the code, self-host it, and open a PR if you need a change or want to add another agent.</p>
      </div>
      <span class="oss-cta">github.com/Ryrahul/session-relay →</span>
    </a>
  </section>
</main>`;
  return page({
    title: "Session Relay: share coding-agent sessions with your team",
    description: "Share Claude Code, Codex, OpenCode, Gemini CLI, Copilot CLI, Cursor and ZCode sessions with your team. /share in one agent, /pickup in another. Self-hosted now, cloud coming soon.",
    body,
    depth: 0,
  });
}

function docPage(slug, md) {
  const title = /^#\s+(.+)$/m.exec(md)?.[1] ?? slug;
  const firstPara = md.split("\n\n").find((p) => p && !p.startsWith("#") && !p.startsWith("|") && !p.startsWith(">")) ?? "";
  const html = rewriteLinks(marked.parse(md), 1);
  const nav = NAV.map(([s, t]) => `<a href="${s}.html"${s === slug ? ' aria-current="page"' : ""}>${esc(t)}</a>`).join("\n");
  const body = `
<div class="docs">
  <aside class="docs-nav" aria-label="Docs">
    <p class="docs-nav-title">Docs</p>
    ${nav}
  </aside>
  <main class="prose">
    ${html}
    <p class="edit"><a href="${REPO}/edit/main/docs/${slug}.md">Edit this page on GitHub</a></p>
  </main>
</div>`;
  return page({
    title: `${title} · Session Relay docs`,
    description: firstPara.replace(/[*`[\]]/g, "").replace(/\(.*?\)/g, "").slice(0, 160),
    body,
    depth: 1,
    active: "docs",
    urlPath: `/docs/${slug}.html`,
  });
}

function redirectPage(urlPath) {
  const to = `${REDIRECT_TO}${urlPath}`;
  return `<!doctype html><meta charset="utf-8"><title>Moved to ${esc(REDIRECT_TO)}</title>
<link rel="canonical" href="${to}"><meta http-equiv="refresh" content="0; url=${to}">
<script>location.replace(${JSON.stringify(to)} + location.hash)</script>
<p>Session Relay's site moved to <a href="${to}">${esc(to)}</a>.</p>
`;
}

if (REDIRECT_TO) {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(path.join(OUT, "docs"), { recursive: true });
  await writeFile(path.join(OUT, ".nojekyll"), "");
  await writeFile(path.join(OUT, "index.html"), redirectPage("/"));
  await writeFile(path.join(OUT, "docs", "index.html"), redirectPage("/docs/getting-started.html"));
  const names = (await readdir(path.join(ROOT, "docs"))).filter((f) => f.endsWith(".md") && f !== "README.md");
  for (const f of names) {
    const slug = f.replace(/\.md$/, "");
    await writeFile(path.join(OUT, "docs", `${slug}.html`), redirectPage(`/docs/${slug}.html`));
  }
  console.log(`Built redirects to ${REDIRECT_TO}: index + ${names.length} doc pages → ${OUT}`);
  process.exit(0);
}

await rm(OUT, { recursive: true, force: true });
await mkdir(path.join(OUT, "docs"), { recursive: true });
await cp(path.join(ROOT, "docs/images"), path.join(OUT, "images"), { recursive: true });
await cp(path.join(ROOT, "site/site.css"), path.join(OUT, "site.css"));
await writeFile(path.join(OUT, "index.html"), landing());
// GitHub Pages: serve files as-is.
await writeFile(path.join(OUT, ".nojekyll"), "");

const docs = (await readdir(path.join(ROOT, "docs"))).filter((f) => f.endsWith(".md") && f !== "README.md");
for (const f of docs) {
  const slug = f.replace(/\.md$/, "");
  await writeFile(path.join(OUT, "docs", `${slug}.html`), docPage(slug, await readFile(path.join(ROOT, "docs", f), "utf8")));
}
await writeFile(path.join(OUT, "docs", "index.html"), `<!doctype html><meta http-equiv="refresh" content="0; url=getting-started.html"><a href="getting-started.html">Docs</a>`);
console.log(`Built site: index + ${docs.length} doc pages → ${OUT}`);
