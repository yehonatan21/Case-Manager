import { env } from "../../env";
import { createOpenAICompatibleProvider } from "./openai-compatible";
import type { AiProvider } from "./types";

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/**
 * OpenRouter (openrouter.ai): one API in front of many models, including free ones (":free").
 * Adds OpenRouter's extras on top of the OpenAI-compatible provider: fallback models when the first is
 * down or rate-limited, a data-collection routing policy, and reasoning effort.
 */
export function openrouterProvider(): AiProvider {
  return createOpenAICompatibleProvider({
    id: "openrouter",
    url: env.openrouterBaseUrl || OPENROUTER_URL,
    apiKey: env.openrouterApiKey,
    model: env.openrouterModel,
    // Optional attribution shown in OpenRouter's dashboard.
    headers: { "HTTP-Referer": env.appUrl, "X-Title": env.appName },
    extraBody: (req) => ({
      reasoning: { effort: req.effort, exclude: true },
      ...(env.openrouterFallbackModels.length ? { models: [env.openrouterModel, ...env.openrouterFallbackModels] } : {}),
      provider: { data_collection: env.openrouterDataCollection, allow_fallbacks: true },
    }),
  });
}
