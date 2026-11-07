import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { json, renderApp, serve } from "../test-support/render.tsx";
import { HomePage } from "./home.tsx";

afterEach(() => vi.unstubAllGlobals());

const unavailable = {
  type: "urn:sms:error:unavailable",
  title: "Service unavailable",
  status: 503,
  code: "unavailable",
  requestId: "req-abcdef12",
};

describe("the home page", () => {
  test("shows that the application and its database work", async () => {
    serve({ "/health": json({ status: "ok", service: "core-api", version: "abc1234" }), "/ready": json({ status: "ready" }) });
    renderApp(<HomePage />);
    expect(await screen.findByText("Running")).toBeTruthy();
    expect(screen.getByText("Version abc1234")).toBeTruthy();
    expect(screen.getByText("Reachable")).toBeTruthy();
  });

  test("says so while it is still waiting", () => {
    serve({ "/health": () => json({ status: "ok", service: "core-api", version: "x" }), "/ready": () => json({ status: "ready" }) });
    renderApp(<HomePage />);
    expect(screen.getAllByText("Checking…")).toHaveLength(2);
  });

  test("a database that does not answer is reported in words, with the reference for support", async () => {
    serve({ "/health": json({ status: "ok", service: "core-api", version: "abc1234" }), "/ready": json(unavailable, 503) });
    renderApp(<HomePage />);
    expect(await screen.findByText("Not reachable")).toBeTruthy();
    expect(screen.getByText("The service is temporarily unavailable. Try again in a few minutes.")).toBeTruthy();
    expect(screen.getByText("Reference: req-abcdef12")).toBeTruthy();
    // The application itself is still reported as running: the two checks are independent.
    expect(screen.getByText("Running")).toBeTruthy();
    // No technical word from the server reaches the screen.
    expect(document.body.textContent).not.toMatch(/Service unavailable|urn:sms/);
  });

  test("an application that cannot be reached is reported as a network problem", async () => {
    serve({ "/health": new TypeError("Failed to fetch"), "/ready": new TypeError("Failed to fetch") });
    renderApp(<HomePage />);
    await waitFor(() => expect(screen.getAllByText(/could not be reached/)).toHaveLength(2));
  });

  test("checking again asks both questions again", async () => {
    const seen = serve({ "/health": json({ status: "ok", service: "core-api", version: "abc1234" }), "/ready": json({ status: "ready" }) });
    renderApp(<HomePage />);
    await screen.findByText("Running");
    expect(seen).toEqual(["/health", "/ready"]);
    await userEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(seen).toHaveLength(4));
    expect(await screen.findByText("Running")).toBeTruthy();
  });

  test("speaks French when asked to", async () => {
    serve({ "/health": json({ status: "ok", service: "core-api", version: "abc1234" }), "/ready": json(unavailable, 503) });
    renderApp(<HomePage />, { language: "fr" });
    expect(await screen.findByText("En marche")).toBeTruthy();
    expect(await screen.findByText("Inaccessible")).toBeTruthy();
    expect(screen.getByText("Référence : req-abcdef12")).toBeTruthy();
  });

  test("a slow answer to an earlier check never replaces the answer to the latest one", async () => {
    const versions = ["old", "new"];
    const releases: (() => void)[] = [];
    let health = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string) => {
        if (input === "/ready") return Promise.resolve(json({ status: "ready" }));
        const version = versions[health] ?? "none";
        const first = health === 0;
        health += 1;
        // The first answer is held back; the second comes at once. The stub ignores the abort signal,
        // as a real network answer that was already on its way would.
        return first
          ? new Promise<Response>((resolve) => releases.push(() => resolve(json({ status: "ok", service: "core-api", version }))))
          : Promise.resolve(json({ status: "ok", service: "core-api", version }));
      }),
    );
    renderApp(<HomePage />);
    await userEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByText("Version new")).toBeTruthy();
    releases[0]?.();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByText("Version new")).toBeTruthy();
    expect(screen.queryByText("Version old")).toBeNull();
  });
});
