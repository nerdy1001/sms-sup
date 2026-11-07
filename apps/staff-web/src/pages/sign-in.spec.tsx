import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import { renderApp } from "../test-support/render.tsx";
import { SignInPage, validateSignIn } from "./sign-in.tsx";

describe("validateSignIn", () => {
  test("accepts an address and a password", () => {
    expect(validateSignIn("name@example.org", "x")).toEqual({});
    expect(validateSignIn("  name@example.org  ", "x")).toEqual({});
  });
  test("asks for what is missing", () => {
    expect(validateSignIn("", "")).toEqual({ email: "signIn.emailRequired", password: "signIn.passwordRequired" });
    expect(validateSignIn("   ", "x")).toEqual({ email: "signIn.emailRequired" });
  });
  test("refuses an address that cannot be one", () => {
    for (const bad of ["name", "name@", "@example.org", "name@example", "na me@example.org"]) {
      expect(validateSignIn(bad, "x"), bad).toEqual({ email: "signIn.emailInvalid" });
    }
  });
  test("does not trim a password, because spaces can be part of it", () => {
    expect(validateSignIn("name@example.org", "   ")).toEqual({});
  });
});

describe("the sign-in page", () => {
  test("says plainly that signing in is not connected yet", () => {
    renderApp(<SignInPage />, { path: "/sign-in" });
    expect(screen.getByText(/not connected yet/)).toBeTruthy();
  });

  test("each field has a label that leads to it", async () => {
    renderApp(<SignInPage />);
    const email = screen.getByLabelText("Email address");
    const password = screen.getByLabelText("Password");
    expect(email.getAttribute("type")).toBe("email");
    expect(password.getAttribute("type")).toBe("password");
    expect(password.getAttribute("autocomplete")).toBe("current-password");
  });

  test("an empty form shows a message beside each field and ties it to the field", async () => {
    renderApp(<SignInPage />);
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    const email = screen.getByLabelText("Email address");
    expect(screen.getByText("Enter your email address.")).toBeTruthy();
    expect(screen.getByText("Enter your password.")).toBeTruthy();
    expect(email.getAttribute("aria-invalid")).toBe("true");
    const described = email.getAttribute("aria-describedby");
    expect(described === null ? "" : document.getElementById(described)?.textContent).toBe("Enter your email address.");
    expect(screen.queryByText("Signing in is not available yet.")).toBeNull();
  });

  test("a complete form ends with a clear message, and nothing is sent", async () => {
    let calls = 0;
    const original = globalThis.fetch;
    globalThis.fetch = () => {
      calls += 1;
      return Promise.reject(new Error("must not be called"));
    };
    try {
      renderApp(<SignInPage />);
      await userEvent.type(screen.getByLabelText("Email address"), "name@example.org");
      await userEvent.type(screen.getByLabelText("Password"), "a password");
      await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
      expect(screen.getByText("Signing in is not available yet.")).toBeTruthy();
      expect(calls).toBe(0);
    } finally {
      globalThis.fetch = original;
    }
  });

  test("the password is never written into the page text", async () => {
    renderApp(<SignInPage />);
    await userEvent.type(screen.getByLabelText("Password"), "very-secret-value");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(document.body.textContent).not.toContain("very-secret-value");
  });

  test("the French form is French", () => {
    renderApp(<SignInPage />, { language: "fr" });
    expect(screen.getByLabelText("Adresse e-mail")).toBeTruthy();
    expect(screen.getByLabelText("Mot de passe")).toBeTruthy();
  });
});
