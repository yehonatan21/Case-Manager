"use client";

import type { Dict } from "./i18n/dictionaries";

export class ApiClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** JSON (or multipart) request to our API with uniform error handling. */
export async function api<T = unknown>(url: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? (opts.body !== undefined || opts.form ? "POST" : "GET"),
      headers: opts.form ? undefined : { "Content-Type": "application/json" },
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
      credentials: "same-origin",
    });
  } catch {
    throw new ApiClientError("network", "Network error", 0);
  }
  let json: { ok: boolean; data?: T; error?: { code: string; message: string } } | null = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON */
  }
  if (!res.ok || !json?.ok) {
    throw new ApiClientError(json?.error?.code ?? "server_error", json?.error?.message ?? res.statusText, res.status);
  }
  return json.data as T;
}

export function errorText(err: unknown, d: Dict): string {
  const code = err instanceof ApiClientError ? err.code : "server_error";
  return (d.errors as Record<string, string>)[code] ?? d.errors.server_error;
}
