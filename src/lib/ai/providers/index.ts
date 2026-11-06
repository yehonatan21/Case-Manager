/**
 * AI provider registry. To use another AI service:
 *   - any OpenAI-compatible API: no code — set AI_PROVIDER=openai-compatible with AI_BASE_URL, AI_API_KEY, AI_MODEL_NAME;
 *   - anything else: write a file exporting an `AiProvider` (see ./types.ts) and add it to `registry` below.
 * With AI_PROVIDER=auto (default) the first configured one in `autoOrder` is used; with none, the app's
 * offline engine answers instead.
 */
import { env } from "../../env";
import { anthropicProvider } from "./anthropic";
import { createOpenAICompatibleProvider } from "./openai-compatible";
import { openrouterProvider } from "./openrouter";
import type { AiProvider } from "./types";

type Entry = { configured: () => boolean; create: () => AiProvider };

const registry: Record<string, Entry> = {
  anthropic: { configured: () => !!env.anthropicApiKey, create: () => anthropicProvider },
  openrouter: { configured: () => !!env.openrouterApiKey, create: openrouterProvider },
  "openai-compatible": {
    configured: () => !!(env.aiBaseUrl && env.aiModelName),
    create: () =>
      createOpenAICompatibleProvider({
        id: "openai-compatible",
        url: `${env.aiBaseUrl.replace(/\/$/, "")}${/\/chat\/completions$/.test(env.aiBaseUrl) ? "" : "/chat/completions"}`,
        apiKey: env.aiApiKey,
        model: env.aiModelName,
        jsonSchemaFormat: env.aiJsonSchema,
      }),
  },
};

/** Tried in this order when AI_PROVIDER=auto. */
const autoOrder = ["anthropic", "openrouter", "openai-compatible"];

export const AI_PROVIDER_IDS = Object.keys(registry);

/** The provider to use, or null for the built-in offline engine. */
export function getAiProvider(): AiProvider | null {
  const wanted = env.aiProvider;
  if (wanted === "mock") return null;
  if (wanted !== "auto") {
    const entry = registry[wanted];
    if (!entry) throw new Error(`Unknown AI_PROVIDER "${wanted}". Use one of: auto, mock, ${AI_PROVIDER_IDS.join(", ")}`);
    return entry.create();
  }
  const id = autoOrder.find((p) => registry[p]!.configured());
  return id ? registry[id]!.create() : null;
}

/**
 * Whether the AI provider in use may keep prompts or train on them: OpenRouter with data collection allowed
 * (needed by most free models). The privacy policy and the AI consent text then say so.
 */
export function aiMayKeepData(): boolean {
  try {
    return getAiProvider()?.id === "openrouter" && env.openrouterDataCollection === "allow";
  } catch {
    return false;
  }
}

/** "mock" when the offline engine is used. */
export function aiProviderName(): string {
  return getAiProvider()?.id ?? "mock";
}

export * from "./types";
