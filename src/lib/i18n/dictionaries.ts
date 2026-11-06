import { he } from "./he";
import { en } from "./en";
import type { Locale } from "./config";

export type Dict = typeof he;
export const dictionaries: Record<Locale, Dict> = { he, en };

/** The privacy policy entry about AI (the one that says whether content is used to train models). */
const AI_PRIVACY_INDEX = 2;

/**
 * The dictionary with the AI texts that match how AI is actually configured: when the provider may keep
 * prompts (free models), the consent text and the privacy policy say so instead of promising it won't.
 */
export function dictFor(locale: Locale, opts: { aiMayKeepData?: boolean } = {}): Dict {
  const d = dictionaries[locale];
  if (!opts.aiMayKeepData) return d;
  const privacy = [...d.legal.privacy];
  privacy[AI_PRIVACY_INDEX] = d.legal.privacyAiMayKeep;
  return { ...d, account: { ...d.account, aiText: d.account.aiTextMayKeep }, legal: { ...d.legal, privacy } };
}
