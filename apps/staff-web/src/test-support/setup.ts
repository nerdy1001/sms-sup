import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Components are removed from the page after each test, so that one test cannot see another's output.
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});
