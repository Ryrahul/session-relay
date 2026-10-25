import type { CliConfig } from "./config.js";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(config: CliConfig, method: string, route: string, body?: unknown, timeoutMs?: number): Promise<T> {
  const res = await fetch(new URL(route, config.server.replace(/\/?$/, "/")), {
    method,
    signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
    headers: {
      authorization: `Bearer ${config.token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `${res.status} ${res.statusText}`);
  return data as T;
}

/** GETs a route and returns the body as text (exports). */
export async function apiText(config: CliConfig, route: string): Promise<string> {
  const res = await fetch(new URL(route, config.server.replace(/\/?$/, "/")), { headers: { authorization: `Bearer ${config.token}` } });
  const text = await res.text();
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      message = JSON.parse(text).error ?? message;
    } catch {
      // not JSON
    }
    throw new ApiError(res.status, message);
  }
  return text;
}
