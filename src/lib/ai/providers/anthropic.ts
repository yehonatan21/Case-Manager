import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { env } from "../../env";
import { AiProviderError, type AiMessage, type AiProvider, type StructuredRequest, type StructuredCallResult } from "./types";

let client: Anthropic | null = null;
function getClient() {
  // Zero-arg constructor resolves ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / an `ant auth login` profile.
  if (!client) client = new Anthropic({ maxRetries: 2, timeout: 90_000 });
  return client;
}

function toAnthropic(m: AiMessage): Anthropic.Beta.BetaMessageParam {
  if (typeof m.content === "string") return { role: m.role, content: m.content };
  const blocks: Anthropic.Beta.BetaContentBlockParam[] = m.content.map((p) =>
    p.type === "text"
      ? { type: "text", text: p.text }
      : p.mimeType === "application/pdf"
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: p.base64 } }
        : { type: "image", source: { type: "base64", media_type: p.mimeType as "image/png", data: p.base64 } },
  );
  return { role: m.role, content: blocks };
}

/**
 * Claude via the Anthropic API. Structured output validated against the Zod schema, adaptive thinking with an
 * explicit effort level, and the server-side refusal fallback so a declined request is retried on
 * Anthropic's recommended model. Reads PDFs and images.
 */
export const anthropicProvider: AiProvider = {
  id: "anthropic",
  get model() {
    return env.aiModel;
  },
  supportsFiles: true,
  async structured<S extends z.ZodType>(req: StructuredRequest<S>): Promise<StructuredCallResult<z.infer<S>>> {
    try {
      const response = await getClient().beta.messages.parse({
        model: env.aiModel,
        max_tokens: req.maxTokens ?? 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: req.system,
        messages: req.messages.map(toAnthropic),
        output_config: { effort: req.effort, format: betaZodOutputFormat(req.schema) },
      });
      if (response.stop_reason === "refusal") {
        throw new AiProviderError(`Model declined the request (${response.stop_details?.category ?? "unknown"})`, false);
      }
      if (response.stop_reason === "max_tokens") throw new AiProviderError("Response was truncated (max_tokens)", true);
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
  },
};
