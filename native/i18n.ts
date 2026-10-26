// Localization: the locale tables (js/i18n.js, string ids as keys) in the
// interface language the runtime reports (Options › Language, else the
// device's). The UI is immediate mode, so a language change shows on the
// next frame with the round, selection and status line kept.
import { onPreferencesChange, preferences } from "starhermit:engine";
import { loadClassic } from "starhermit:script";

loadClassic("js/i18n.js");
type Translator = (key: string, vars?: Record<string, string | number>) => string;
interface I18nApi { LOCALES: string[]; make(locale: string): Translator; pick(tags: string[]): string }
const I18n = (globalThis as unknown as { AVI18n: I18nApi }).AVI18n;

export const LOCALES = I18n.LOCALES;
// Regions that speak a regional variant: en-AU reads en-GB, es-MX es-419.
const REGION: Record<string, string> = {
  "en-AU": "en-GB", "en-NZ": "en-GB", "en-IE": "en-GB", "en-IN": "en-GB", "en-ZA": "en-GB",
  "es-MX": "es-419", "es-AR": "es-419", "es-CO": "es-419", "fr-BE": "fr-FR", "fr-CH": "fr-FR", "pt-PT": "pt-BR",
};

/** The supported locale nearest a BCP 47 tag. */
export function pickLocale(tag: string): string {
  const region = Object.keys(REGION).find((r) => r.toLowerCase() === tag.toLowerCase());
  return region ? REGION[region]! : I18n.pick([tag]);
}

export let locale = pickLocale(preferences().language);
let tr = I18n.make(locale);
onPreferencesChange((p) => {
  const next = pickLocale(p.language);
  if (next !== locale) { locale = next; tr = I18n.make(locale); }
});

/** Translates a string id; `{name}` placeholders come from `vars`. */
export function T(key: string, vars?: Record<string, string | number>): string { return tr(key, vars); }
/** Whether the table has the id (a refusal reason without its own text). */
export function has(key: string): boolean { return tr(key) !== key; }
