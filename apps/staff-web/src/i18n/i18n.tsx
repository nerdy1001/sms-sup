import i18next, { type i18n as I18n } from "i18next";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { I18nextProvider, useTranslation as useI18next } from "react-i18next";
import { readLanguage, saveLanguage } from "./language-preference.ts";
import { en, fr, type Language, type MessageKey } from "./messages.ts";

/**
 * The language of the interface, handled by i18next and react-i18next. French when the browser asks for
 * French, English otherwise, and the person can switch.
 *
 * Three settings keep the library inside the rules of this application:
 * - No language detector plugin. The usual one reads localStorage and cookies, which the application never
 *   does (rule web-browser-storage). The language lives in memory, so a reload returns to the browser's language.
 * - The keys contain dots ("app.name"), so the key and namespace separators are switched off.
 * - Values are not escaped by the library, because React escapes everything it draws.
 *
 * The texts stay in TypeScript (messages.ts) and the wrapper below accepts only a known key, so a misspelt
 * key is a type error, as it was before the library.
 */

export type Parameters = Readonly<Record<string, string | number>>;

export function languageOf(preference: string | undefined): Language {
  return preference !== undefined && preference.toLowerCase().startsWith("fr") ? "fr" : "en";
}

/** One i18next instance per provider, so that tests and pages never share state. */
export function createI18n(language: Language): I18n {
  const instance = i18next.createInstance();
  void instance.init({
    lng: language,
    fallbackLng: "en",
    supportedLngs: ["en", "fr"],
    resources: { en: { translation: en }, fr: { translation: fr } },
    keySeparator: false,
    nsSeparator: false,
    interpolation: { escapeValue: false },
    initAsync: false,
    react: { useSuspense: false },
  });
  return instance;
}

interface Translation {
  readonly language: Language;
  readonly setLanguage: (language: Language) => void;
  readonly t: (key: MessageKey, parameters?: Parameters) => string;
}

export function LanguageProvider(props: { readonly children: ReactNode; readonly initial?: Language }) {
  const [instance] = useState(() =>
    createI18n(props.initial ?? readLanguage() ?? languageOf(typeof navigator === "undefined" ? undefined : navigator.language)),
  );
  useEffect(() => {
    const show = (language: string): void => {
      document.documentElement.lang = language;
    };
    show(instance.language);
    instance.on("languageChanged", show);
    return () => instance.off("languageChanged", show);
  }, [instance]);
  return <I18nextProvider i18n={instance}>{props.children}</I18nextProvider>;
}

export function useTranslation(): Translation {
  const { t, i18n } = useI18next();
  const language = languageOf(i18n.language);
  const setLanguage = useCallback(
    (next: Language) => {
      saveLanguage(next);
      void i18n.changeLanguage(next);
    },
    [i18n],
  );
  const translate = useCallback(
    (key: MessageKey, parameters?: Parameters) => (parameters === undefined ? t(key) : t(key, { ...parameters })),
    [t],
  );
  return useMemo(() => ({ language, setLanguage, t: translate }), [language, setLanguage, translate]);
}
