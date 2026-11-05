import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { env } from "@/lib/env";
import { aiCaseSummary, aiDocAnalysis, aiIntakeTurn, aiProviderName, type CaseContext } from "@/lib/ai";
import { OPENROUTER_URL, openrouterProvider } from "@/lib/ai/providers/openrouter";
import { extractJson, jsonSchemaFor, repairLeakedFields } from "@/lib/ai/providers/openai-compatible";
import { getAiProvider, AI_PROVIDER_IDS, type AiProvider } from "@/lib/ai/providers";

const callOpenRouterStructured: AiProvider["structured"] = (req) => openrouterProvider().structured(req);
import { IntakeTurnSchema } from "@/lib/ai/schemas";
import { AppError } from "@/lib/errors";
import { setupDb } from "./helpers";

let db: Database;
const saved = { aiBaseUrl: env.aiBaseUrl, aiApiKey: env.aiApiKey, aiModelName: env.aiModelName, aiJsonSchema: env.aiJsonSchema, aiProvider: env.aiProvider, anthropicApiKey: env.anthropicApiKey, openrouterApiKey: env.openrouterApiKey, openrouterModel: env.openrouterModel, openrouterFallbackModels: env.openrouterFallbackModels, openrouterDataCollection: env.openrouterDataCollection };

/** Fake OpenRouter: answers each request with the next queued reply and records what was sent. */
type Reply = { status?: number; content?: string; finish?: string; refusal?: string; error?: string; model?: string };
let queue: Reply[];
let requests: { url: string; headers: Record<string, string>; body: Record<string, any> }[];
function fakeOpenRouter() {
  queue = [];
  requests = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      requests.push({ url: String(input), headers: init!.headers as Record<string, string>, body: JSON.parse(String(init!.body)) });
      const r = queue.shift() ?? { content: "{}" };
      if (r.status && r.status >= 400) return Response.json({ error: { code: r.status, message: r.error ?? "error" } }, { status: r.status });
      return Response.json({
        model: r.model ?? "nvidia/nemotron-3.5-super-vl:free",
        choices: [{ message: { content: r.content ?? null, refusal: r.refusal ?? null }, finish_reason: r.finish ?? "stop" }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      });
    }),
  );
}

const summary = {
  request_title: "מעבר לפורטוגל",
  request_description: "המשפחה רוצה לעבור לפורטוגל בקיץ הבא",
  service_category: "relocation",
  customer_goal: "לגור בפורטוגל",
  known_facts: [{ label: "יעד", value: "פורטוגל" }],
  constraints: [],
  missing_information: ["אזרחות נוכחית"],
  suggested_next_questions: [],
  urgency: "normal",
  needs_human_review: true,
  assumptions: [],
};
const turn = { reply: "מה האזרחות הנוכחית שלך?", quick_replies: ["ישראלית", "אחרת"], ready_for_review: false, summary };
const Small = z.object({ answer: z.string(), count: z.number() });

beforeAll(async () => {
  db = await setupDb();
});
beforeEach(() => {
  fakeOpenRouter();
  Object.assign(env, { aiProvider: "openrouter", anthropicApiKey: "", openrouterApiKey: "sk-or-test", openrouterModel: "nvidia/nemotron-3.5-super-vl:free", openrouterFallbackModels: ["google/gemma-4-31b-it:free"], openrouterDataCollection: "allow" });
});
afterEach(() => {
  vi.unstubAllGlobals();
  Object.assign(env, saved);
});

describe("choosing the AI provider", () => {
  it("auto: Claude if its key is set, else OpenRouter, else the offline engine", () => {
    Object.assign(env, { aiProvider: "auto", anthropicApiKey: "", openrouterApiKey: "" });
    expect(aiProviderName()).toBe("mock");
    Object.assign(env, { openrouterApiKey: "sk-or-x" });
    expect(aiProviderName()).toBe("openrouter");
    Object.assign(env, { anthropicApiKey: "sk-ant-x" });
    expect(aiProviderName()).toBe("anthropic");
  });

  it("a mistyped AI_PROVIDER is reported instead of silently ignored", () => {
    Object.assign(env, { aiProvider: "openruoter" });
    expect(() => getAiProvider()).toThrow(/Unknown AI_PROVIDER "openruoter".*openrouter/);
    expect(AI_PROVIDER_IDS).toEqual(["anthropic", "openrouter", "openai-compatible"]);
  });

  it("each provider says whether documents may be sent to it", () => {
    Object.assign(env, { aiProvider: "anthropic" });
    expect(getAiProvider()!.supportsFiles).toBe(true);
    Object.assign(env, { aiProvider: "openrouter" });
    expect(getAiProvider()!.supportsFiles).toBe(false);
    Object.assign(env, { aiProvider: "mock" });
    expect(getAiProvider()).toBeNull();
  });

  it("AI_PROVIDER forces a provider", () => {
    for (const p of ["openrouter", "anthropic", "mock"] as const) {
      Object.assign(env, { aiProvider: p, anthropicApiKey: "sk-ant-x", openrouterApiKey: "sk-or-x" });
      expect(aiProviderName()).toBe(p);
    }
  });
});

describe("OpenRouter requests", () => {
  it("sends the model, fallbacks, JSON schema, system prompt and key", async () => {
    queue.push({ content: JSON.stringify({ answer: "yes", count: 2 }) });
    const r = await callOpenRouterStructured({ system: "Be brief.", messages: [{ role: "user", content: "Hi" }], schema: Small, effort: "low", maxTokens: 500 });
    expect(r).toEqual({ output: { answer: "yes", count: 2 }, model: "nvidia/nemotron-3.5-super-vl:free", inputTokens: 100, outputTokens: 50 });
    const req = requests[0]!;
    expect(req.url).toBe(OPENROUTER_URL);
    expect(req.headers.Authorization).toBe("Bearer sk-or-test");
    expect(req.headers["X-Title"]).toBe(env.appName);
    expect(req.body).toMatchObject({
      model: "nvidia/nemotron-3.5-super-vl:free",
      models: ["nvidia/nemotron-3.5-super-vl:free", "google/gemma-4-31b-it:free"],
      max_tokens: 500,
      response_format: { type: "json_schema", json_schema: { name: "response", strict: true } },
      reasoning: { effort: "low", exclude: true },
      provider: { data_collection: "allow" },
    });
    expect(req.body.response_format.json_schema.schema).toMatchObject({ type: "object", properties: { answer: { type: "string" }, count: { type: "number" } } });
    expect(req.body.messages[0].role).toBe("system");
    expect(req.body.messages[0].content).toContain("Be brief.");
    expect(req.body.messages[0].content).toContain('"answer"'); // schema also described in the prompt (JSON-mode models)
    expect(req.body.messages[1]).toEqual({ role: "user", content: "Hi" });
  });

  it("OPENROUTER_DATA_COLLECTION=deny restricts to providers that don't keep prompts", async () => {
    Object.assign(env, { openrouterDataCollection: "deny", openrouterFallbackModels: [] });
    queue.push({ content: JSON.stringify({ answer: "a", count: 1 }) });
    await callOpenRouterStructured({ system: "x", messages: [{ role: "user", content: "y" }], schema: Small, effort: "medium" });
    expect(requests[0]!.body.provider.data_collection).toBe("deny");
    expect(requests[0]!.body.models).toBeUndefined();
  });

  it("accepts JSON wrapped in a code fence or in text", async () => {
    queue.push({ content: 'Here you go:\n```json\n{"answer":"fenced","count":1}\n```' });
    expect((await callOpenRouterStructured({ system: "x", messages: [], schema: Small, effort: "low" })).output.answer).toBe("fenced");
    queue.push({ content: 'Sure! {"answer":"inline","count":3} Hope this helps.' });
    expect((await callOpenRouterStructured({ system: "x", messages: [], schema: Small, effort: "low" })).output.answer).toBe("inline");
  });

  it("asks once more when the reply doesn't match the schema, telling the model what was wrong", async () => {
    queue.push({ content: '{"answer":"x"}' }, { content: '{"answer":"x","count":5}' });
    const r = await callOpenRouterStructured({ system: "x", messages: [{ role: "user", content: "q" }], schema: Small, effort: "low" });
    expect(r.output.count).toBe(5);
    expect(r.inputTokens).toBe(200); // both attempts counted
    const retry = requests[1]!.body.messages.at(-1);
    expect(retry.role).toBe("user");
    expect(retry.content).toContain("count");
  });

  it("gives up after a second bad reply, and retries a cut-off reply", async () => {
    queue.push({ content: "not json" }, { content: "still not json" });
    await expect(callOpenRouterStructured({ system: "x", messages: [], schema: Small, effort: "low" })).rejects.toThrow(/didn't match/);
    queue.push({ content: '{"answer":', finish: "length" }, { content: '{"answer":"ok","count":1}' });
    expect((await callOpenRouterStructured({ system: "x", messages: [], schema: Small, effort: "low" })).output.answer).toBe("ok");
  });

  it("turns API errors into clear messages", async () => {
    const cases: [number, RegExp][] = [
      [401, /Authentication/],
      [402, /credits/],
      [429, /rate limit/],
      [500, /OpenRouter error/],
    ];
    for (const [status, msg] of cases) {
      queue.push({ status });
      await expect(callOpenRouterStructured({ system: "x", messages: [], schema: Small, effort: "low" })).rejects.toThrow(msg);
    }
    queue.push({ refusal: "I can't help with that" });
    await expect(callOpenRouterStructured({ system: "x", messages: [], schema: Small, effort: "low" })).rejects.toThrow(/declined/);
  });

  it("helpers: JSON extraction and schema conversion", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(() => extractJson("no json here")).toThrow();
    const js = jsonSchemaFor(IntakeTurnSchema);
    expect(js.$schema).toBeUndefined();
    expect(js).toMatchObject({ type: "object", properties: { reply: { type: "string" }, summary: { type: "object" } } });
  });

  it("recovers a reply whose text swallowed the other fields (seen with some models)", () => {
    const summary = { request_title: "הגשת תביעת ביטוח דירה", request_description: "d", service_category: "other", customer_goal: "g", known_facts: [], constraints: [], missing_information: [], suggested_next_questions: [], urgency: "normal", needs_human_review: false, assumptions: [] };
    const leaked = `קיבלתי את בקשתך. מה קרה בדירה?","quick_replies":["נזק מים","שריפה"],"ready_for_review":false,"summary":${JSON.stringify({ ...summary, request_title: "נכון" })}`;
    const raw = { reply: leaked, quick_replies: [], ready_for_review: false, summary };
    const fixed = repairLeakedFields(IntakeTurnSchema.parse(raw), IntakeTurnSchema);
    expect(fixed.reply).toBe("קיבלתי את בקשתך. מה קרה בדירה?");
    expect(fixed.quick_replies).toEqual(["נזק מים", "שריפה"]);
    expect(fixed.summary.request_title).toBe("נכון");
    // Not rebuildable: the leaked part is cut off.
    const broken = repairLeakedFields(IntakeTurnSchema.parse({ ...raw, reply: 'שאלה?","quick_replies":["x"' }), IntakeTurnSchema);
    expect(broken.reply).toBe("שאלה?");
    // Ordinary text with quotes and commas is left alone.
    const fine = repairLeakedFields(IntakeTurnSchema.parse({ ...raw, reply: 'He said "yes", then left.' }), IntakeTurnSchema);
    expect(fine.reply).toBe('He said "yes", then left.');
  });
});

describe("replacing OpenRouter with another OpenAI-compatible service (no code)", () => {
  it("AI_PROVIDER=openai-compatible uses AI_BASE_URL / AI_API_KEY / AI_MODEL_NAME", async () => {
    Object.assign(env, { aiProvider: "openai-compatible", aiBaseUrl: "https://api.groq.com/openai/v1/", aiApiKey: "gsk-test", aiModelName: "llama-4-70b" });
    const p = getAiProvider()!;
    expect(p).toMatchObject({ id: "openai-compatible", model: "llama-4-70b", supportsFiles: false });
    queue.push({ content: JSON.stringify({ answer: "hi", count: 1 }), model: "llama-4-70b" });
    const r = await p.structured({ system: "x", messages: [{ role: "user", content: "y" }], schema: Small, effort: "low" });
    expect(r.output.answer).toBe("hi");
    expect(requests[0]!.url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(requests[0]!.headers.Authorization).toBe("Bearer gsk-test");
    // OpenRouter-only extras aren't sent to other services.
    expect(requests[0]!.body.models).toBeUndefined();
    expect(requests[0]!.body.provider).toBeUndefined();
    expect(requests[0]!.body.response_format.type).toBe("json_schema");
  });

  it("AI_JSON_SCHEMA=false falls back to plain JSON mode for services without schema support", async () => {
    Object.assign(env, { aiProvider: "openai-compatible", aiBaseUrl: "http://localhost:11434/v1/chat/completions", aiModelName: "qwen3", aiJsonSchema: false });
    queue.push({ content: '{"answer":"local","count":0}' });
    await getAiProvider()!.structured({ system: "x", messages: [], schema: Small, effort: "low" });
    expect(requests[0]!.url).toBe("http://localhost:11434/v1/chat/completions");
    expect(requests[0]!.body.response_format).toEqual({ type: "json_object" });
  });

  it("is picked automatically when it's the only one configured", () => {
    Object.assign(env, { aiProvider: "auto", anthropicApiKey: "", openrouterApiKey: "", aiBaseUrl: "https://api.example.com/v1", aiModelName: "m" });
    expect(getAiProvider()!.id).toBe("openai-compatible");
  });
});

describe("the app's AI features through OpenRouter", () => {
  it("intake chat: the customer's message is sent redacted, the reply is used, the run is logged", async () => {
    queue.push({ content: JSON.stringify(turn) });
    const intakeSessionId = crypto.randomUUID();
    const { turn: out, runId } = await aiIntakeTurn(db, {
      intakeSessionId,
      locale: "he",
      company: "Case Manager",
      messages: [{ role: "user", content: "אני רוצה לעבור לפורטוגל. הטלפון שלי 050-1234567 והמייל dana@example.com", at: new Date().toISOString() } as s.IntakeChatMessage],
      asked: 0,
      limit: 7,
      categories: "other — Other / אחר", skippedLabel: "(skipped)",
    });
    expect(out.reply).toBe("מה האזרחות הנוכחית שלך?");
    expect(out.summary.service_category).toBe("relocation");
    const sent = JSON.stringify(requests[0]!.body.messages);
    expect(sent).not.toContain("050-1234567");
    expect(sent).not.toContain("dana@example.com");
    const [row] = await db.select().from(s.aiRuns).where(eq(s.aiRuns.id, runId));
    expect(row).toMatchObject({ provider: "openrouter", model: "nvidia/nemotron-3.5-super-vl:free", status: "ok", action: "intake_turn", inputTokens: 100, outputTokens: 50 });
  });

  it("a failure is logged and reported as ai_unavailable, so the app falls back to the manual flow", async () => {
    queue.push({ status: 429 });
    const intakeSessionId = crypto.randomUUID();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    let err: unknown;
    try {
      await aiIntakeTurn(db, { intakeSessionId, locale: "en", company: "X", messages: [{ role: "user", content: "hi", at: new Date().toISOString() } as s.IntakeChatMessage], asked: 0, limit: 7, categories: "other — Other / אחר", skippedLabel: "-" });
    } catch (e) {
      err = e;
    }
    spy.mockRestore();
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("ai_unavailable");
    const [row] = await db.select().from(s.aiRuns).where(eq(s.aiRuns.intakeSessionId, intakeSessionId));
    expect(row).toMatchObject({ provider: "openrouter", model: "nvidia/nemotron-3.5-super-vl:free", status: "error" });
    expect(row!.error).toMatch(/rate limit/);
  });

  it("staff copilot: case summary goes through OpenRouter", async () => {
    queue.push({ content: JSON.stringify({ what_client_wants: "Move to Portugal", known_facts: [{ fact: "Grandfather born in Lisbon", source_refs: ["INTAKE"] }], missing_information: [], complexities: [], recommended_next_step: "Ask for documents" }) });
    const ctx: CaseContext = { caseId: crypto.randomUUID(), number: "CASE-1", title: "Move", description: "d", goal: "g", status: "submitted", category: "relocation", customerName: "Dana", intake: null, messages: [], documents: [], openTasks: [] };
    const r = await aiCaseSummary(db, { ctx, locale: "en" });
    expect(r.provider).toBe("openrouter");
    expect(r.output.recommended_next_step).toBe("Ask for documents");
    expect(requests).toHaveLength(1);
  });

  it("documents are never sent to OpenRouter (analysed offline instead)", async () => {
    const r = await aiDocAnalysis(db, { caseId: crypto.randomUUID(), locale: "en", title: "Passport", mimeType: "application/pdf", data: Buffer.from("%PDF-1.4 secret passport") });
    expect(requests).toHaveLength(0);
    expect(r.provider).toBe("openrouter");
    const [row] = await db.select().from(s.aiRuns).where(eq(s.aiRuns.id, r.runId));
    expect(row!.model).toBe("offline-heuristic");
  });
});
