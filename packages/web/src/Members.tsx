import { useEffect, useState, type FormEvent } from "react";
import type { Member, MeResponse } from "@session-relay/shared";
import { api } from "./api";

export function Members({ me }: { me: MeResponse }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("member");
  const [created, setCreated] = useState<{ name: string; command: string } | null>(null);
  const [error, setError] = useState("");
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
      void load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section className="members">
      <h1>Members</h1>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.id}>
              <td>{m.name}</td>
              <td className="mono">{m.email}</td>
              <td>{m.role}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {isAdmin && (
        <form className="card invite" onSubmit={invite}>
          <h3>Add a teammate</h3>
          <div className="grid">
            <label htmlFor="inv-name">Name</label>
            <input id="inv-name" value={name} onChange={(e) => setName(e.target.value)} required />
            <label htmlFor="inv-email">Email</label>
            <input id="inv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <label htmlFor="inv-role">Role</label>
            <select id="inv-role" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <button type="submit">Add</button>
          {error && <p className="error">{error}</p>}
          {created && (
            <div className="created">
              <p>
                Added {created.name}. Send them this command privately. It is shown only once:
              </p>
              <pre>{created.command}</pre>
            </div>
          )}
        </form>
      )}
    </section>
  );
}
