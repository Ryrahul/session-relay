import { api, ApiError } from "../api.js";
import { configPath, writeConfig } from "../config.js";

interface Me {
  user: { name: string; email: string };
  org: { name: string };
  role: string;
}

export async function login(opts: { server: string; token: string }): Promise<void> {
  const config = { server: opts.server, token: opts.token };
  try {
    const me = await api<Me>(config, "GET", "v1/me");
    await writeConfig(config);
    console.log(`Logged in as ${me.user.name} <${me.user.email}> (${me.role}) in ${me.org.name}.`);
    console.log(`Saved to ${configPath()}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      throw new Error("The server rejected that token. Ask an org admin for a new one.");
    }
    throw new Error(`Could not reach ${opts.server}: ${(err as Error).message}`);
  }
}
