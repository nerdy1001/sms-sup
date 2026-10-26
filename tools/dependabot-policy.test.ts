import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { evaluateDependabotPr } from "./dependabot-policy.ts";

const message = (type: string, version = "1.2.4", name = "zod"): string =>
  `Bumps ${name}.\n\n---\nupdated-dependencies:\n- dependency-name: ${name}\n  dependency-version: ${version}\n  dependency-type: direct:production\n  update-type: version-update:semver-${type}\n...\n`;
const FILES = ["package.json", "package-lock.json"];

describe("evaluateDependabotPr", () => {
  test("a patch update of dependency files merges", () => {
    assert.equal(evaluateDependabotPr({ messages: message("patch"), files: FILES }).merge, true);
  });

  test("a minor update merges", () => {
    assert.equal(evaluateDependabotPr({ messages: message("minor", "2.3.0"), files: FILES }).merge, true);
  });

  test("a major update does not", () => {
    const result = evaluateDependabotPr({ messages: message("major", "3.0.0"), files: FILES });
    assert.equal(result.merge, false);
    assert.match(result.reason, /major/);
  });

  test("one major among several updates stops the whole pull request", () => {
    assert.equal(evaluateDependabotPr({ messages: message("patch") + message("major", "5.0.0", "other"), files: FILES }).merge, false);
  });

  test("a minor update of a 0.x package does not", () => {
    assert.equal(evaluateDependabotPr({ messages: message("minor", "0.5.0"), files: FILES }).merge, false);
  });

  test("a patch update of a 0.x package merges", () => {
    assert.equal(evaluateDependabotPr({ messages: message("patch", "0.5.1"), files: FILES }).merge, true);
  });

  test("a commit message without Dependabot metadata does not merge", () => {
    assert.equal(evaluateDependabotPr({ messages: "Update stuff", files: FILES }).merge, false);
  });

  test("a change outside the dependency files does not merge", () => {
    const result = evaluateDependabotPr({ messages: message("patch"), files: [...FILES, "apps/core-api/src/main.ts"] });
    assert.equal(result.merge, false);
    assert.match(result.reason, /main\.ts/);
  });

  test("workspace manifests and workflow files count as dependency files", () => {
    assert.equal(evaluateDependabotPr({ messages: message("patch"), files: ["apps/core-api/package.json", "packages/contracts/package.json", ".github/workflows/ci.yml"] }).merge, true);
  });

  test("an empty list of files does not merge", () => {
    assert.equal(evaluateDependabotPr({ messages: message("patch"), files: [] }).merge, false);
  });

  test("a package.json in a deeper folder is not a dependency file of this repository", () => {
    assert.equal(evaluateDependabotPr({ messages: message("patch"), files: ["tools/evil/package.json"] }).merge, false);
  });
});
