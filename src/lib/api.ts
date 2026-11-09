import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError } from "./errors";

export type RouteCtx<P extends Record<string, string> = Record<string, string>> = { params: Promise<P> };

/** Reject cross-site state-changing requests (CSRF defence in depth on top of SameSite cookies). */
export function assertSameOrigin(req: Request) {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = req.headers.get("origin");
  if (!origin) return; // non-browser clients
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    if (new URL(origin).host !== host) throw new AppError("forbidden", "Cross-origin request blocked");
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError("forbidden", "Bad origin");
  }
}

export async function readJson<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new AppError("validation", "Invalid JSON body");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new AppError("validation", "Invalid request", z.treeifyError(parsed.error));
  return parsed.data;
}

export function ok(data: unknown = null, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, init);
}

export function errorResponse(err: unknown) {
  if (err instanceof AppError) {
    return NextResponse.json({ ok: false, error: { code: err.code, message: err.message, details: err.details } }, { status: err.status });
  }
  console.error("[api] unhandled error", err);
  return NextResponse.json({ ok: false, error: { code: "server_error", message: "Internal error" } }, { status: 500 });
}

/** Wrap a route handler: same-origin check + uniform error responses. */
export function route<P extends Record<string, string> = Record<string, string>>(
  fn: (req: Request, params: P) => Promise<Response>,
) {
  return async (req: Request, ctx: RouteCtx<P>) => {
    try {
      assertSameOrigin(req);
      const params = ctx?.params ? await ctx.params : ({} as P);
      return await fn(req, params);
    } catch (err) {
      // An unexpected error (not an AppError the code meant to throw) is recorded for the admins.
      if (!(err instanceof AppError)) void reportServerError(err, new URL(req.url).pathname);
      return errorResponse(err);
    }
  };
}

async function reportServerError(err: unknown, path: string) {
  try {
    const [{ getDb }, { recordError }] = await Promise.all([import("./db"), import("./services/error-tracking")]);
    const e = err instanceof Error ? err : new Error(String(err));
    await recordError(await getDb(), { source: "server", message: `${e.name}: ${e.message}`, stack: e.stack, path });
  } catch {}
}
