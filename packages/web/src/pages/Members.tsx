import { useEffect, useState, type FormEvent } from "react";
import type { InviteInfo, Member, MeResponse } from "@session-relay/shared";
import { api } from "../api";
import { ago } from "../format";
import { Avatar, Command, Icon } from "../ui";

function InviteLinks({ me }: { me: MeResponse }) {
  const [role, setRole] = useState("member");
  const [days, setDays] = useState("7");
  const [created, setCreated] = useState<string | null>(null);
  const [invites, setInvites] = useState<InviteInfo[]>([]);
  const [error, setError] = useState("");

  const load = () => api.invites().then((r) => setInvites(r.invites), () => undefined);
  useEffect(() => {
    void load();
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const r = await api.createInvite(role, Number(days));
      setCreated(r.url);
      void load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function revoke(id: string) {
    await api.revokeInvite(id).catch((e) => setError(e.message));
    void load();
  }

  return (
    <section className="card">
      <h2>Invite with a link</h2>
      <p className="muted small">Send the link to one person. It works once; they pick their name and email and are signed in straight away.</p>
      <form className="inline-form" onSubmit={create}>
        <label htmlFor="inv-link-role" className="sr-only">
          Role
        </label>
        <select id="inv-link-role" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="member">Member</option>
          <option value="admin">Admin</option>
          {me.role === "owner" && <option value="owner">Owner</option>}
        </select>
        <label htmlFor="inv-link-days" className="sr-only">
          Expires
        </label>
        <select id="inv-link-days" value={days} onChange={(e) => setDays(e.target.value)}>
          <option value="1">Expires in 1 day</option>
          <option value="7">Expires in 7 days</option>
          <option value="30">Expires in 30 days</option>
        </select>
        <button type="submit" className="btn-primary">
          <Icon name="chain" size={14} /> Create link
        </button>
      </form>
      {created && (
        <div className="reveal">
          <p>Copy it now; it isn't shown again. Send it privately to one person.</p>
          <Command>{created}</Command>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {invites.length > 0 && (
        <div className="invite-links">
          {invites.slice(0, 8).map((i) => (
            <div key={i.id} className="invite-row">
              <div>
                <span className={`status-pill status-${i.status}`}>{i.status}</span> <span className="role">{i.role}</span>{" "}
                <span className="muted">
                  {i.status === "used"
                    ? `joined as ${i.used_by}`
                    : `created by ${i.created_by ?? "someone"} ${ago(i.created_at)} · expires ${new Date(i.expires_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`}
                </span>
              </div>
              {i.status === "pending" && (
                <button type="button" className="btn-ghost btn-sm" onClick={() => revoke(i.id)}>
                  Revoke
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function Members({ me }: { me: MeResponse }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("member");
  const [created, setCreated] = useState<{ name: string; command: string } | null>(null);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const isAdmin = me.role !== "member";

  const load = () => api.members().then((r) => setMembers(r.members), (e) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);

  async function invite(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const { user, token } = await api.invite(email.trim(), name.trim(), role);
      setCreated({ name: user.name, command: `relay login --server ${location.origin} --token ${token}` });
      setEmail("");
      setName("");
      setRole("member");
      void load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(userId: string) {
    setError("");
    try {
      await api.removeMember(userId);
      setConfirming(null);
      void load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Members</h1>
          <p className="muted">
            {members ? `${members.length} ${members.length === 1 ? "person" : "people"} in ${me.org.name}.` : " "}
          </p>
        </div>
      </header>

      {isAdmin && <InviteLinks me={me} />}

      {isAdmin && (
        <details className="card add-direct">
          <summary>
            <h2>Or add someone directly</h2>
          </summary>
          <form className="invite-form" onSubmit={invite}>
            <div className="field">
              <label htmlFor="inv-name">Name</label>
              <input id="inv-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="inv-email">Email</label>
              <input id="inv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required aria-describedby="inv-email-hint" />
            </div>
            <div className="field">
              <label htmlFor="inv-role">Role</label>
              <select id="inv-role" value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="member">Member</option>
                <option value="admin">Admin</option>
                {me.role === "owner" && <option value="owner">Owner</option>}
              </select>
            </div>
            <button type="submit" className="btn-primary">
              <Icon name="plus" size={14} /> Add
            </button>
          </form>
          <p id="inv-email-hint" className="hint">
            The email only identifies them in Session Relay. It doesn't need to match their Claude, OpenCode or Codex account; they log in with the token.
          </p>
          {created && (
            <div className="reveal">
              <p>
                <strong>{created.name}</strong> was added. Send them this command privately. The token is shown only once.
              </p>
              <Command>{created.command}</Command>
            </div>
          )}
        </details>
      )}

      {error && <p className="error">{error}</p>}

      <section className="card flush">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th className="hide-sm">Joined</th>
              {isAdmin && <th aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {members?.map((m) => (
              <tr key={m.id}>
                <td>
                  <div className="person">
                    <Avatar name={m.name} size={30} />
                    <div>
                      <div className="person-name">
                        {m.name}
                        {m.id === me.user.id && <span className="faint"> (you)</span>}
                      </div>
                      <div className="faint small">{m.email}</div>
                    </div>
                  </div>
                </td>
                <td>
                  <span className={`role role-${m.role}`}>{m.role}</span>
                </td>
                <td className="hide-sm faint">{ago(m.joined_at)}</td>
                {isAdmin && (
                  <td className="actions">
                    {m.id !== me.user.id && (m.role !== "owner" || me.role === "owner") &&
                      (confirming === m.id ? (
                        <span className="row">
                          <button type="button" className="btn-danger btn-sm" onClick={() => remove(m.id)}>
                            Remove
                          </button>
                          <button type="button" className="btn-ghost btn-sm" onClick={() => setConfirming(null)}>
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button type="button" className="btn-ghost btn-sm" onClick={() => setConfirming(m.id)}>
                          Remove
                        </button>
                      ))}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {isAdmin && <p className="hint">Removing someone revokes all their tokens straight away. Their shares stay.</p>}
    </div>
  );
}
