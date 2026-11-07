import { NavLink, Outlet } from "react-router";
import { useTranslation } from "../i18n/i18n.tsx";
import { LANGUAGES } from "../i18n/messages.ts";
import { cn } from "../ui/cn.ts";

function LanguageSwitch() {
  const { t, language, setLanguage } = useTranslation();
  return (
    <div role="group" aria-label={t("language.switch")} className="flex gap-1">
      {LANGUAGES.map((code) => (
        <button
          key={code}
          type="button"
          lang={code}
          aria-pressed={language === code}
          onClick={() => setLanguage(code)}
          className={cn(
            "rounded px-2 py-1 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
            language === code ? "bg-white font-semibold text-brand" : "text-white hover:bg-blue-800",
          )}
        >
          {t(code === "en" ? "language.en" : "language.fr")}
        </button>
      ))}
    </div>
  );
}

const link = ({ isActive }: { isActive: boolean }): string =>
  cn(
    "rounded px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
    isActive ? "bg-blue-950 font-semibold" : "hover:bg-blue-800",
  );

/** The frame around every page: a way to skip the navigation, the header, and the main area. */
export function Shell() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-10 focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:text-brand"
      >
        {t("app.name")}
      </a>
      <header className="bg-brand text-brand-ink">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <p className="text-lg font-semibold">
            {t("app.name")} <span className="font-normal opacity-90">· {t("app.audience")}</span>
          </p>
          <nav aria-label={t("nav.main")} className="flex flex-wrap items-center gap-1">
            <NavLink to="/" end className={link}>
              {t("nav.home")}
            </NavLink>
            <NavLink to="/sign-in" className={link}>
              {t("nav.signIn")}
            </NavLink>
          </nav>
          <LanguageSwitch />
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
