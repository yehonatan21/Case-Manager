import "server-only";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, type Locale } from "./config";
import { dictFor } from "./dictionaries";
import { aiMayKeepData } from "../ai/providers";

/** Locale from cookie, then Accept-Language, then the Hebrew default. */
export const getLocale = cache(async (): Promise<Locale> => {
  const c = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(c)) return c;
  const accept = (await headers()).get("accept-language") ?? "";
  const first = accept.split(",")[0]?.trim().slice(0, 2).toLowerCase();
  if (first === "en") return "en";
  return DEFAULT_LOCALE;
});

export async function getDict() {
  const locale = await getLocale();
  return { locale, d: dictFor(locale, { aiMayKeepData: aiMayKeepData() }) };
}
