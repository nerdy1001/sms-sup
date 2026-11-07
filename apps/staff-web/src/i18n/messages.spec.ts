import { ERROR_CODES } from "@minesup/contracts";
import { describe, expect, test } from "vitest";
import { createI18n, languageOf } from "./i18n.tsx";
import { en, fr, type MessageKey } from "./messages.ts";

const keys = Object.keys(en) as MessageKey[];
const placeholders = (text: string): string[] => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1] ?? "").sort();

describe("the message catalogues", () => {
  test("both languages have exactly the same keys", () => {
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
  });

  test("every error code of the API has a sentence in both languages", () => {
    for (const code of ERROR_CODES) {
      expect(en[`error.${code}`], code).toBeTruthy();
      expect(fr[`error.${code}`], code).toBeTruthy();
    }
  });

  test("no sentence is empty, and the sentences are not copies across the two languages", () => {
    const same = keys.filter((key) => en[key] === fr[key]);
    for (const key of keys) {
      expect(en[key].trim(), key).not.toBe("");
      expect(fr[key].trim(), key).not.toBe("");
    }
    // Names (of languages) and words that are spelled the same in both may match; a sentence may not.
    expect(same.filter((key) => key.startsWith("error.") || key.startsWith("signIn.") || key.startsWith("home."))).toEqual([]);
  });

  test("a placeholder in one language is in the other", () => {
    for (const key of keys) expect(placeholders(fr[key]), key).toEqual(placeholders(en[key]));
  });

  test("the error sentences never show a technical term to the person", () => {
    for (const key of keys.filter((candidate) => candidate.startsWith("error.") && candidate !== "error.reference")) {
      expect(en[key], key).not.toMatch(/\b(http|json|sql|null|exception|stack)\b/i);
    }
  });
});

describe("translation with i18next", () => {
  test("fills in a value, in both languages", () => {
    expect(createI18n("en").t("status.version", { version: "abc123" })).toBe("Version abc123");
    expect(createI18n("fr").t("status.version", { version: "abc123" })).toBe("Version abc123");
  });
  test("leaves a placeholder without a value visible", () => {
    expect(createI18n("en").t("status.version", {})).toBe("Version {{version}}");
  });
  test("a value that looks like a placeholder is not expanded again", () => {
    expect(createI18n("en").t("error.reference", { reference: "{{reference}}" })).toBe("Reference: {{reference}}");
  });
  test("a value with markup is returned as text, because React escapes it when it draws", () => {
    expect(createI18n("en").t("status.version", { version: "<b>x</b>" })).toBe("Version <b>x</b>");
  });
  test("each instance has its own language", () => {
    const first = createI18n("en");
    const second = createI18n("fr");
    expect(first.t("nav.home")).toBe("Home");
    expect(second.t("nav.home")).toBe("Accueil");
    void first.changeLanguage("fr");
    expect(first.t("nav.home")).toBe("Accueil");
    expect(second.language).toBe("fr");
  });
});

describe("languageOf", () => {
  test("French for any French setting, English otherwise", () => {
    expect(languageOf("fr")).toBe("fr");
    expect(languageOf("fr-CM")).toBe("fr");
    expect(languageOf("FR-ca")).toBe("fr");
    expect(languageOf("en-GB")).toBe("en");
    expect(languageOf("de")).toBe("en");
    expect(languageOf(undefined)).toBe("en");
  });
});
