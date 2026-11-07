import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { checkSecrets } from "./secrets.ts";
import { createProject, type Project } from "../test-support/project.ts";

let project: Project | undefined;
afterEach(() => {
  project?.cleanup();
  project = undefined;
});

const AWS = "AK" + "IA" + "ABCDEFGHIJKLMNOP";

function run(files: Record<string, string>) {
  project = createProject(files);
  return checkSecrets(project.root);
}

test("a clean project passes", () => {
  assert.deepEqual(run({ "docs/a.md": "Nothing here.\n" }).findings, []);
});

test("a secret in any text file is reported with its place, masked", () => {
  const result = run({ "docs/setup.md": `Line one\nkey: ${AWS}\n` });
  assert.deepEqual(
    result.findings.map((item) => [item.rule, item.file, item.line]),
    [["secret-aws-access-key", "docs/setup.md", 2]],
  );
  assert.ok(!(result.findings[0]?.message ?? "").includes(AWS));
});

test("a forbidden file name is reported even when the file is empty", () => {
  const result = run({ ".env": "", "data/scholars.xlsx": "x" });
  assert.deepEqual(result.findings.map((item) => item.rule).sort(), ["data-file", "secret-file"]);
});

test("an allowed example is listed as a suppression, not a finding", () => {
  const result = run({ "docs/a.md": `<!-- secrets-allow: aws-access-key -- the vendor documentation example -->\n${AWS}\n` });
  assert.deepEqual(result.findings, []);
  assert.deepEqual(
    result.suppressions.map((item) => item.rule),
    ["secret-aws-access-key"],
  );
});

test("the lock file and binary files are not scanned", () => {
  const result = run({ "package-lock.json": `{"x": "${AWS}"}\n`, "assets/logo.bin": `\0${AWS}` });
  assert.deepEqual(result.findings, []);
});
