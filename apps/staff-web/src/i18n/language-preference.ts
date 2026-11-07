import type { Language } from "./messages.ts";

/**
 * The one place in the application that touches browser storage, by a decided exception to the rule
 * web-browser-storage (docs/adr/0008, decision 3). What is kept is the language the person chose: the two
 * letters "en" or "fr", under one key, and nothing else. It is not a secret and not personal data, so a
 * script that reads or changes it learns and harms nothing. A value that is not exactly "en" or "fr" is
 * ignored when read, so a changed value cannot put anything into the page.
 *
 * Storage can be missing or refuse to work (private windows, blocked site data), so every call is guarded
 * and the application works without it.
 */
const KEY = "sms.language";

function storage(): Storage | undefined {
  try {
    // web-ignore: web-browser-storage -- keeps only the chosen language, "en" or "fr" (ADR 0008, decision 3)
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function readLanguage(): Language | undefined {
  try {
    const value = storage()?.getItem(KEY);
    return value === "en" || value === "fr" ? value : undefined;
  } catch {
    return undefined;
  }
}

export function saveLanguage(language: Language): void {
  try {
    storage()?.setItem(KEY, language);
  } catch {
    // Storage is full or refused: the choice lasts until the page is reloaded, which is acceptable.
  }
}
