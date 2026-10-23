import type { MeResponse } from "@session-relay/shared";
import { Command } from "../ui";

const REPO = "https://github.com/Ryrahul/session-relay";

export function Start({ me }: { me: MeResponse }) {
  const server = location.origin;
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Get started</h1>
          <p className="muted">Connect your laptop and your agents to {me.org.name}. Takes about two minutes.</p>
        </div>
      </header>

      <ol className="steps">
        <li className="step">
          <div className="step-body">
            <h2>Install the relay CLI</h2>
            <p className="muted">Needs Node.js 20 or newer.</p>
            <Command>npm install -g session-relay</Command>
          </div>
        </li>
        <li className="step">
          <div className="step-body">
            <h2>Log in to this server</h2>
            <p className="muted">
              Use your personal token. If you don't have one, create one in <a href="#/settings">Settings</a>, or ask an admin.
            </p>
            <Command copy={`relay login --server ${server} --token `}>{`relay login --server ${server} --token srk_…`}</Command>
          </div>
        </li>
        <li className="step">
          <div className="step-body">
            <h2>Connect your agents</h2>
            <p className="muted">
              Adds the relay MCP server and the <code>/share</code> and <code>/pickup</code> commands to Claude Code, OpenCode and
              Codex, whichever are installed. Restart your agents afterwards.
            </p>
            <Command>relay setup</Command>
          </div>
        </li>
        <li className="step">
          <div className="step-body">
            <h2>Share and pick up</h2>
            <div className="two-col">
              <div>
                <h3>When you stop working</h3>
                <p className="muted small">The agent writes a handoff (goal, decisions, next steps) and shares the session.</p>
                <Command>/share</Command>
              </div>
              <div>
                <h3>When you take over</h3>
                <p className="muted small">The agent finds the session, reads it, checks the code and carries on.</p>
                <Command>{"/pickup alice's webhook retry work"}</Command>
              </div>
            </div>
          </div>
        </li>
      </ol>

      <section className="card tips">
        <h2>Good to know</h2>
        <ul>
          <li>
            Nothing is uploaded unless you share it. Secrets (API keys, tokens, passwords, private keys) are removed on your machine first. Preview
            exactly what would be sent with <code>relay share --dry-run</code>.
          </li>
          <li>
            Share with specific people: <code>/share only Bob</code> or <code>relay share --people bob</code>.
          </li>
          <li>
            By default a share has the summary and the last 30 messages. Ask for <code>/share full transcript</code> to include everything.
          </li>
          <li>
            From a terminal: <code>relay list</code>, <code>relay search "…"</code>, <code>relay pull &lt;id&gt;</code>. See the{" "}
            <a href={`${REPO}/blob/main/docs/cli.md`} target="_blank" rel="noreferrer">
              CLI reference
            </a>
            .
          </li>
        </ul>
      </section>
    </div>
  );
}
