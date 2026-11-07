import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { LanguageProvider, useTranslation } from "./i18n.tsx";
import { readLanguage, saveLanguage } from "./language-preference.ts";

afterEach(() => vi.restoreAllMocks());

function Probe() {
  const { t, setLanguage } = useTranslation();
  return (
    <div>
      <p>{t("nav.home")}</p>
      <button type="button" onClick={() => setLanguage("fr")}>
        choose french
      </button>
      <button type="button" onClick={() => setLanguage("en")}>
        choose english
      </button>
    </div>
  );
}
const show = () =>
  render(
    <LanguageProvider>
      <Probe />
    </LanguageProvider>,
  );

describe("the saved language", () => {
  test("only the two letters of a known language are accepted", () => {
    saveLanguage("fr");
    expect(readLanguage()).toBe("fr");
    window.localStorage.setItem("sms.language", "<script>");
    expect(readLanguage()).toBeUndefined();
    window.localStorage.setItem("sms.language", "FR");
    expect(readLanguage()).toBeUndefined();
  });

  test("nothing is stored until the person chooses", () => {
    show();
    expect(window.localStorage.length).toBe(0);
  });

  test("a choice is kept and used the next time the page opens", async () => {
    const first = show();
    await userEvent.click(screen.getByText("choose french"));
    expect(screen.getByText("Accueil")).toBeTruthy();
    expect(window.localStorage.getItem("sms.language")).toBe("fr");
    first.unmount();
    show();
    expect(screen.getByText("Accueil")).toBeTruthy();
    expect(document.documentElement.lang).toBe("fr");
  });

  test("the choice wins over the language of the browser", async () => {
    vi.spyOn(navigator, "language", "get").mockReturnValue("fr-CM");
    const first = show();
    expect(screen.getByText("Accueil")).toBeTruthy();
    await userEvent.click(screen.getByText("choose english"));
    first.unmount();
    show();
    expect(screen.getByText("Home")).toBeTruthy();
  });

  test("a tampered value is ignored and the browser language is used", () => {
    window.localStorage.setItem("sms.language", "../../etc");
    show();
    expect(screen.getByText("Home")).toBeTruthy();
  });

  test("the page works when storage refuses to be used", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    show();
    expect(screen.getByText("Home")).toBeTruthy();
    await userEvent.click(screen.getByText("choose french"));
    expect(screen.getByText("Accueil")).toBeTruthy();
  });
});
