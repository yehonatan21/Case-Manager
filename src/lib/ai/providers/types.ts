/**
 * The contract every AI provider implements. The app's AI features (intake chat, case summary, quote draft,
 * task plan, text tools, document analysis) only talk to this interface, so a provider can be swapped by
 * configuration (AI_PROVIDER) or added by writing one file and registering it in ./index.ts.
 */
import type { z } from "zod";

/** A piece of a message: text, or a file (PDF/image) for providers that can read files. */
export type ContentPart = { type: "text"; text: string } | { type: "file"; mimeType: string; base64: string; name?: string };

export type AiMessage = { role: "user" | "assistant"; content: string | ContentPart[] };

export type StructuredRequest<S extends z.ZodType> = {
  system: string;
  messages: AiMessage[];
  /** The reply must match this schema; providers validate before returning. */
  schema: S;
  /** How hard the model should think. Providers map it to whatever they support (or ignore it). */
  effort: "low" | "medium" | "high";
  maxTokens?: number;
};

export type StructuredCallResult<T> = {
  output: T;
  /** The model that actually answered (for the ai_runs log). */
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
};

export interface AiProvider {
  /** Stable id, stored in ai_runs.provider and shown by /api/health (e.g. "anthropic", "openrouter"). */
  readonly id: string;
  /** The configured model, for logging failures. */
  readonly model: string;
  /** Whether uploaded documents (PDFs, images) may be sent to this provider for analysis. */
  readonly supportsFiles: boolean;
  structured<S extends z.ZodType>(req: StructuredRequest<S>): Promise<StructuredCallResult<z.infer<S>>>;
}

/** Provider failure. `retryable` tells whether trying again later might work (rate limits, outages). */
export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

/** Flattens messages to plain text, for providers that can't take files. */
export const textOf = (content: AiMessage["content"]) =>
  typeof content === "string" ? content : content.map((p) => (p.type === "text" ? p.text : `[file: ${p.name ?? p.mimeType}]`)).join("\n");
