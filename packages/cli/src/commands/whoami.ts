import { api } from "../api.js";
import { resolveConfig } from "../config.js";

export async function whoami(): Promise<void> {
  const config = await resolveConfig();
  if (!config) throw new Error("Not logged in. Run: relay login --server <url> --token <token>");
  const me = await api<{ user: { name: string; email: string }; org: { name: string }; role: string }>(
    config,
    "GET",
    "v1/me",
  );
  console.log(`${me.user.name} <${me.user.email}> · ${me.org.name} · ${me.role} · ${config.server}`);
}
