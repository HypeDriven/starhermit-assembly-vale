// Localization: the locale tables (assets/strings.json, string ids as keys; the
// account and leaderboard lines are the engine's `starhermit.*` strings) in the
// interface language the engine's strings follow (Options › Language, else the
// device's). The UI is immediate mode, so a language change shows on the next
// frame with the round, selection and status line kept.
import { strings } from "starhermit:engine";
import * as ui from "starhermit:ui";

strings.load("assets/strings.json");
strings.defaultLocale = "en-US";
ui.setLanguage(strings.locale);
strings.onChange((locale) => ui.setLanguage(locale));

/** Translates a string id; `{name}` placeholders come from `vars`. */
export function T(key: string, vars?: Record<string, string | number>): string { return strings.t(key, vars); }
