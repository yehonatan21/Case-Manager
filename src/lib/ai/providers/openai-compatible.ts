/**
 * A provider for any OpenAI-compatible chat-completions API (OpenRouter, OpenAI, Groq, Mistral, Together,
 * a local Ollama/vLLM, ...). Structured output: we ask for a JSON schema (`response_format: json_schema`)
 * and also describe the schema in the system prompt, so models that only support JSON mode work too.
 * Replies are validated against the Zod schema, with one repair retry.
 */
import { z } from "zod";
import { AiProviderError, textOf, type AiMessage, type AiProvider, type StructuredRequest, type StructuredCallResult } from "./types";

export type OpenAICompatibleConfig = {
  id: string;
  /** Full chat-completions URL, e.g. https://openrouter.ai/api/v1/chat/completions */
  url: string;
  apiKey: string;
  model: string;
  /** Extra headers (attribution etc.). */
  headers?: Record<string, string>;
  /** Extra request fields specific to the service (fallback models, routing, reasoning...). */
  extraBody?: (req: StructuredRequest<z.ZodType>) => Record<string, unknown>;
  /** Some services don't accept `response_format: json_schema`; then only the prompt describes the schema. */
  jsonSchemaFormat?: boolean;
  timeoutMs?: number;
};

type ChatResponse = {
  model?: string;
  choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { code?: number | string; message?: string };
};

/** JSON schema for the response, without the $schema key some services reject. */
export function jsonSchemaFor(schema: z.ZodType): Record<string, unknown> {
  const js = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
  delete js.$schema;
  return js;
}

/** Pulls the JSON object out of a model reply: plain JSON, a ```json fence, or text around one object. */
export function extractJson(text: string): unknown {
  const t = text.trim();
  try {
    return JSON.parse(t);
  } catch {}
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    try {
      return JSON.parse(fence[1]!.trim());
    } catch {}
  }
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(t.slice(start, end + 1));
    } catch {}
  }
  throw new AiProviderError("Model reply was not valid JSON", true);
}

export function createOpenAICompatibleProvider(cfg: OpenAICompatibleConfig): AiProvider {
  const name = cfg.id === "openai-compatible" ? "AI provider" : cfg.id === "openrouter" ? "OpenRouter" : cfg.id;

  async function post(body: Record<string, unknown>): Promise<ChatResponse> {
    let res: Response;
    try {
      res = await fetch(cfg.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json", ...cfg.headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(cfg.timeoutMs ?? 90_000),
      });
    } catch (err) {
      throw new AiProviderError(`${name} request failed: ${String(err)}`, true);
    }
    let json: ChatResponse | null = null;
    try {
      json = (await res.json()) as ChatResponse;
    } catch {}
    if (!res.ok || json?.error) {
      const msg = json?.error?.message ?? `HTTP ${res.status}`;
      if (res.status === 401 || res.status === 403) throw new AiProviderError(`Authentication with ${name} failed`, false);
      if (res.status === 402) throw new AiProviderError(`${name}: insufficient credits`, false);
      if (res.status === 429) throw new AiProviderError(`${name} rate limit (free models allow a limited number of requests per day)`, true);
      throw new AiProviderError(`${name} error: ${msg}`, res.status >= 500);
    }
    return json!;
  }

  return {
    id: cfg.id,
    model: cfg.model,
    supportsFiles: false,
    async structured<S extends z.ZodType>(req: StructuredRequest<S>): Promise<StructuredCallResult<z.infer<S>>> {
      const schemaJson = jsonSchemaFor(req.schema);
      const system = `${req.system}\n\nRespond with a single JSON object only — no prose, no code fences — that matches this JSON schema:\n${JSON.stringify(schemaJson)}`;
      const messages = [{ role: "system", content: system }, ...req.messages.map((m: AiMessage) => ({ role: m.role, content: textOf(m.content) }))];
      const base = {
        model: cfg.model,
        max_tokens: req.maxTokens ?? 8000,
        temperature: 0.3,
        ...(cfg.jsonSchemaFormat === false ? { response_format: { type: "json_object" } } : { response_format: { type: "json_schema", json_schema: { name: "response", strict: true, schema: schemaJson } } }),
        ...cfg.extraBody?.(req as StructuredRequest<z.ZodType>),
      };

      let inputTokens = 0;
      let outputTokens = 0;
      let lastError = "";
      for (let attempt = 0; attempt < 2; attempt++) {
        const body =
          attempt === 0
            ? { ...base, messages }
            : { ...base, messages: [...messages, { role: "user", content: `Your previous reply was invalid (${lastError}). Reply again with only the JSON object that matches the schema.` }] };
        const res = await post(body);
        inputTokens += res.usage?.prompt_tokens ?? 0;
        outputTokens += res.usage?.completion_tokens ?? 0;
        const choice = res.choices?.[0];
        if (choice?.message?.refusal) throw new AiProviderError(`Model declined the request: ${choice.message.refusal}`, false);
        if (choice?.finish_reason === "length") {
          lastError = "it was cut off";
          continue;
        }
        try {
          const parsed = req.schema.safeParse(extractJson(choice?.message?.content ?? ""));
          if (parsed.success) return { output: parsed.data as z.infer<S>, model: res.model ?? cfg.model, inputTokens: inputTokens || null, outputTokens: outputTokens || null };
          lastError = parsed.error.issues
            .slice(0, 5)
            .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
            .join("; ");
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
        }
      }
      throw new AiProviderError(`${name} reply didn't match the expected format: ${lastError}`, true);
    },
  };
}
