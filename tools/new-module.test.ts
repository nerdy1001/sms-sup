import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import { runChecks } from "./check.ts";
import { scaffoldModule } from "./new-module.ts";
import { createProject, type Project } from "./test-support/project.ts";

let project: Project | undefined;
afterEach(() => {
  project?.cleanup();
  project = undefined;
});

function fresh(): Project {
  project = createProject();
  return project;
}

test("a scaffolded module has the standard layout and passes every check", () => {
  const { root } = fresh();
  const written = scaffoldModule(root, "RG");
  assert.ok(written.includes("apps/core-api/src/modules/registry/module.json"));
  for (const layer of ["domain", "application", "infrastructure", "http"]) {
    assert.ok(existsSync(join(root, `apps/core-api/src/modules/registry/internal/${layer}/.gitkeep`)));
  }
  const manifest = JSON.parse(readFileSync(join(root, "apps/core-api/src/modules/registry/module.json"), "utf8")) as {
    code: string;
    database: { schema: string };
  };
  assert.equal(manifest.code, "RG");
  assert.equal(manifest.database.schema, "registry");
  const report = runChecks(root);
  assert.deepEqual(report.findings, []);
});

test("a module with a declared dependency passes, and a shortcut around its public API fails", () => {
  const { root, write } = fresh();
  scaffoldModule(root, "CF");
  scaffoldModule(root, "RG", { dependsOn: ["configuration"] });
  write("apps/core-api/src/modules/configuration/internal/domain/country.ts", "export const country = 'CM';\n");

  const clean = runChecks(root, ["imports", "structure"]);
  assert.deepEqual(
    clean.findings.map((item) => item.rule),
    ["unused-declared-dependency"],
  );

  write(
    "apps/core-api/src/modules/registry/internal/application/shortcut.ts",
    'import { country } from "../../../configuration/internal/domain/country.ts";\nexport const c = country;\n',
  );
  const broken = runChecks(root, ["imports", "structure"]);
  assert.ok(broken.findings.some((item) => item.rule === "module-public-api" && item.severity === "error"));
});

test("a module in the portal application gets its own folder and schema", () => {
  const { root } = fresh();
  scaffoldModule(root, "PT");
  assert.ok(existsSync(join(root, "apps/portal-api/src/modules/student-portal/module.json")));
  assert.deepEqual(runChecks(root).findings, []);
});

describe("refusals", () => {
  test("an unknown code", () => {
    assert.throws(() => scaffoldModule(fresh().root, "ZZ"), /No planned module with code "ZZ"/);
  });
  test("a code that exists in both applications without --app", () => {
    assert.throws(() => scaffoldModule(fresh().root, "SY"), /Add --app/);
  });
  test("a code that exists in both applications with --app", () => {
    scaffoldModule(fresh().root, "SY", { app: "portal-api" });
    assert.ok(project !== undefined && existsSync(join(project.root, "apps/portal-api/src/modules/sync/module.json")));
  });
  test("a module that already exists", () => {
    const { root } = fresh();
    scaffoldModule(root, "RG");
    assert.throws(() => scaffoldModule(root, "RG"), /already exists/);
  });
  test("a dependency that does not exist yet", () => {
    assert.throws(() => scaffoldModule(fresh().root, "RG", { dependsOn: ["configuration"] }), /no such module/);
  });
});
