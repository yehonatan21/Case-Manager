import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { env } from "../env";

let client: Anthropic | null = null;
function getClient() {
  // Zero-arg constructor resolves ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / an `ant auth login` profile.
  if (!client) client = new Anthropic({ maxRetries: 2, timeout: 90_000 });
  return client;
}

export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export type StructuredCallResult<T> = {
  output: T;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
};

/**
 * One structured-output call to Claude. The response is validated against the Zod schema.
 * Uses adaptive thinking (always on for this model), an explicit effort level, and the
 * server-side refusal fallback so a declined request is retried on Anthropic's recommended model.
 */
export async function callClaudeStructured<S extends z.ZodType>(opts: {
  system: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  schema: S;
  effort: "low" | "medium" | "high";
  maxTokens?: number;
}): Promise<StructuredCallResult<z.infer<S>>> {
  try {
    const response = await getClient().beta.messages.parse({
      model: env.aiModel,
      max_tokens: opts.maxTokens ?? 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: opts.system,
      messages: opts.messages,
      output_config: { effort: opts.effort, format: betaZodOutputFormat(opts.schema) },
    });
    if (response.stop_reason === "refusal") {
      throw new AiProviderError(`Model declined the request (${response.stop_details?.category ?? "unknown"})`, false);
    }
    if (response.stop_reason === "max_tokens") {
      throw new AiProviderError("Response was truncated (max_tokens)", true);
    }
    if (!response.parsed_output) throw new AiProviderError("Structured output could not be parsed", true);
    return {
      output: response.parsed_output as z.infer<S>,
      model: response.model,
      inputTokens: response.usage?.input_tokens ?? null,
      outputTokens: response.usage?.output_tokens ?? null,
    };
  } catch (err) {
    if (err instanceof AiProviderError) throw err;
    if (err instanceof Anthropic.AuthenticationError) throw new AiProviderError("Authentication with the AI provider failed", false);
    if (err instanceof Anthropic.BadRequestError) throw new AiProviderError(`Bad request: ${err.message}`, false);
    if (err instanceof Anthropic.RateLimitError) throw new AiProviderError("AI provider rate limit", true);
    if (err instanceof Anthropic.APIError) throw new AiProviderError(`AI provider error ${err.status}`, true);
    throw new AiProviderError(`AI call failed: ${String(err)}`, true);
  }
}
