import { he } from "./he";
import { en } from "./en";
import type { Locale } from "./config";

export type Dict = typeof he;
export const dictionaries: Record<Locale, Dict> = { he, en };
