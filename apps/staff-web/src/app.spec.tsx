import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { App } from "./app.tsx";
import { json, renderApp, serve } from "./test-support/render.tsx";

afterEach(() => vi.unstubAllGlobals());

const healthy = () =>
  serve({ "/health": json({ status: "ok", service: "core-api", version: "abc1234" }), "/ready": json({ status: "ready" }) });

describe("the application", () => {
  test("opens on the home page inside the frame", async () => {
    healthy();
    renderApp(<App />);
    expect(screen.getByRole("heading", { level: 1, name: "Scholarship management" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Main navigation" })).toBeTruthy();
    expect(screen.getByRole("main")).toBeTruthy();
    await screen.findByText("Running");
  });

  test("the sign-in address shows the sign-in page", () => {
    renderApp(<App />, { path: "/sign-in" });
    expect(screen.getByRole("heading", { level: 1, name: "Sign in" })).toBeTruthy();
  });

  test("an address that does not exist shows a page that says so and leads home", () => {
    renderApp(<App />, { path: "/no/such/page" });
    expect(screen.getByRole("heading", { level: 1, name: "Page not found" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to the home page" }).getAttribute("href")).toBe("/");
  });

  test("the link of the page you are on is marked as current", () => {
    renderApp(<App />, { path: "/sign-in" });
    const links = screen.getAllByRole("link");
    const current = links.filter((link) => link.getAttribute("aria-current") === "page").map((link) => link.textContent);
    expect(current).toEqual(["Sign in"]);
  });

  test("the first thing a keyboard reaches is a link that skips the navigation", () => {
    renderApp(<App />, { path: "/sign-in" });
    const first = screen.getAllByRole("link")[0];
    expect(first?.getAttribute("href")).toBe("#main");
  });

  test("switching the language changes the page and the language of the document", async () => {
    renderApp(<App />, { path: "/sign-in" });
    expect(document.documentElement.lang).toBe("en");
    await userEvent.click(screen.getByRole("button", { name: "Français" }));
    expect(screen.getByRole("heading", { level: 1, name: "Se connecter" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Navigation principale" })).toBeTruthy();
    await waitFor(() => expect(document.documentElement.lang).toBe("fr"));
    expect(screen.getByRole("button", { name: "Français" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "English" }).getAttribute("aria-pressed")).toBe("false");
  });

  test("moving between pages does not reload the application", async () => {
    healthy();
    renderApp(<App />);
    await userEvent.click(screen.getByRole("link", { name: "Sign in" }));
    expect(screen.getByRole("heading", { level: 1, name: "Sign in" })).toBeTruthy();
    await userEvent.click(screen.getByRole("link", { name: "Home" }));
    expect(screen.getByRole("heading", { level: 1, name: "Scholarship management" })).toBeTruthy();
  });
});
