import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router";
import { vi } from "vitest";
import { LanguageProvider } from "../i18n/i18n.tsx";
import type { Language } from "../i18n/messages.ts";

/** Shows a page the way the application does: with a language and a router that starts at `path`. */
export function renderApp(element: ReactElement, options: { path?: string; language?: Language } = {}) {
  return render(
    <LanguageProvider initial={options.language ?? "en"}>
      <MemoryRouter initialEntries={[options.path ?? "/"]}>{element}</MemoryRouter>
    </LanguageProvider>,
  );
}

type Route = Response | (() => Response) | Error;

/** Replaces fetch with answers per address. An address that is not listed fails the test, so no call goes unnoticed. */
export function serve(routes: Record<string, Route>) {
  const seen: string[] = [];
  const fetchStub = vi.fn((input: string) => {
    seen.push(input);
    const route = routes[input];
    if (route === undefined) return Promise.reject(new Error(`Unexpected call to ${input}`));
    if (route instanceof Error) return Promise.reject(route);
    return Promise.resolve(typeof route === "function" ? route() : route.clone());
  });
  vi.stubGlobal("fetch", fetchStub);
  return seen;
}

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": status < 400 ? "application/json" : "application/problem+json" },
  });
