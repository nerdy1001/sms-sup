import assert from "node:assert/strict";
import { test } from "node:test";
import { checkPrTitle } from "./check-pr-title.ts";

test("accepts titles that follow the convention", () => {
  for (const title of [
    "feat(rg): add scholar identifier",
    "fix(cm,py): correct the commitment total",
    "chore(deps): bump typescript",
    "docs: explain the module layout",
    "refactor(fn)!: rename the kernel folder",
  ]) {
    assert.equal(checkPrTitle(title), undefined, title);
  }
});

test("rejects titles that do not", () => {
  for (const title of [
    "Added stuff",
    "feat: x",
    "feat(unknown): add things here",
    "feature(rg): add scholar identifier",
    "feat(rg) add scholar identifier",
    "feat(rg): add scholar identifier.",
    "",
    `feat(rg): ${"a".repeat(100)}`,
  ]) {
    assert.notEqual(checkPrTitle(title), undefined, title);
  }
});
