import { spawn } from "node:child_process";
import { hostname, userInfo } from "node:os";
import type { DeviceStart } from "@session-relay/shared";
import { api, ApiError } from "../api.js";
import { configPath, writeConfig } from "../config.js";

interface Me {
  user: { name: string; email: string };
  org: { name: string };
  role: string;
}

function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => undefined).unref();
  } catch {
    // No browser available (SSH session, container): the URL is printed anyway.
  }
}

async function post(server: string, route: string, body: unknown): Promise<{ status: number; data: any }> {
  const res = await fetch(new URL(route, server.replace(/\/?$/, "/")), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

/** Browser login: show a code, let a signed-in user approve it on the web, receive a token. */
async function browserLogin(server: string, openIt: boolean): Promise<string> {
  const clientName = `${userInfo().username}@${hostname().replace(/\.local$/, "")}`;
  const start = await post(server, "v1/auth/device", { client_name: clientName });
  if (start.status !== 201) throw new Error(start.data?.error ?? `Could not start login (${start.status})`);
  const d = start.data as DeviceStart;

  console.log(`\nTo sign in, open:\n  ${d.verification_url}\n\nand check that it shows this code:  ${d.user_code}\n`);
  if (openIt) openBrowser(d.verification_url);
  process.stdout.write("Waiting for approval in the browser…");

  const deadline = Date.now() + d.expires_in * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, d.interval * 1000));
    const p = await post(server, "v1/auth/device/token", { device_code: d.device_code });
    if (p.status === 202) continue;
    process.stdout.write("\n");
    if (p.status === 200 && p.data.token) return p.data.token as string;
    throw new Error(p.data?.error ?? `Login failed (${p.status})`);
  }
  process.stdout.write("\n");
  throw new Error("The code expired. Run relay login again.");
}

export async function login(opts: { server: string; token?: string; browser?: boolean }): Promise<void> {
  let server = opts.server;
  try {
    new URL(server);
  } catch {
    throw new Error(`"${server}" isn't a URL. Use the address of your Session Relay server, e.g. https://relay.example.com`);
  }
  server = server.replace(/\/$/, "");
  const token = opts.token ?? (await browserLogin(server, opts.browser !== false));
  const config = { server, token };
  try {
    const me = await api<Me>(config, "GET", "v1/me");
    await writeConfig(config);
    console.log(`Logged in as ${me.user.name} <${me.user.email}> (${me.role}) in ${me.org.name}.`);
    console.log(`Saved to ${configPath()}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      throw new Error("The server rejected that token. Ask an org admin for a new one.");
    }
    throw new Error(`Could not reach ${server}: ${(err as Error).message}`);
  }
}
