import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { checkRegister, REGISTER_PATH } from "./register.ts";
import { createProject, type Project } from "../test-support/project.ts";

let project: Project | undefined;
afterEach(() => {
  project?.cleanup();
  project = undefined;
});

const HEADER =
  "| Package | Used by | What it is for | Why not written by hand | If it is abandoned | Where it may be imported |\n|---|---|---|---|---|---|\n";
const row = (name: string, usedBy = "root", text = "a sentence long enough"): string =>
  `| \`${name}\` | ${usedBy} | ${text} | ${text} | ${text} | ${text} |\n`;

const run = (files: Record<string, string>): { rule: string; severity: string }[] => {
  project = createProject(files);
  return checkRegister(project.root).findings.map((item) => ({ rule: item.rule, severity: item.severity }));
};
const manifest = (extra: object): string => JSON.stringify({ name: "fixture", private: true, ...extra });

describe("the register", () => {
  test("a project with the base dependency and a complete row passes", () => {
    assert.deepEqual(run({ [REGISTER_PATH]: HEADER + row("typescript") }), []);
  });
  test("a missing register is an error when dependencies exist", () => {
    project = createProject({});
    project.remove(REGISTER_PATH);
    assert.deepEqual(
      checkRegister(project.root).findings.map((item) => item.rule),
      ["register-missing"],
    );
  });
  test("a dependency without a row is an error", () => {
    assert.deepEqual(
      run({
        [REGISTER_PATH]: HEADER + row("typescript"),
        "package.json": manifest({ devDependencies: { typescript: "6.0.3", fastify: "5.0.0" } }),
      }).map((item) => item.rule),
      ["register-unregistered"],
    );
  });
  test("a row with too little text is an error", () => {
    assert.deepEqual(
      run({ [REGISTER_PATH]: HEADER + row("typescript", "root", "todo") }).map((item) => item.rule),
      ["register-incomplete", "register-incomplete", "register-incomplete", "register-incomplete"],
    );
  });
  test("a dependency used in a workspace the row does not list is an error", () => {
    const files = {
      [REGISTER_PATH]: HEADER + row("typescript") + row("zod", "contracts"),
      "packages/contracts/package.json": manifest({ name: "@minesup/contracts", dependencies: { zod: "4.1.0" } }),
      "apps/core-api/package.json": manifest({ name: "@minesup/core-api", dependencies: { "@minesup/contracts": "*", zod: "4.1.0" } }),
    };
    assert.deepEqual(
      run(files).map((item) => item.rule),
      ["register-usage"],
    );
  });
  test("workspace packages of this repository are not dependencies", () => {
    assert.deepEqual(run({ [REGISTER_PATH]: HEADER + row("typescript") }), []);
  });
  test("a row for something nobody declares is a warning, not an error", () => {
    assert.deepEqual(run({ [REGISTER_PATH]: HEADER + row("typescript") + row("left-pad") }), [
      { rule: "register-stale", severity: "warning" },
    ]);
  });
  test("text outside the table is ignored", () => {
    assert.deepEqual(run({ [REGISTER_PATH]: `# Dependencies\n\nSome words | with a pipe.\n\n${HEADER}${row("typescript")}` }), []);
  });
  test("no dependencies and no register passes", () => {
    project = createProject({ "package.json": manifest({}) });
    project.remove(REGISTER_PATH);
    assert.deepEqual(checkRegister(project.root).findings, []);
  });
});
