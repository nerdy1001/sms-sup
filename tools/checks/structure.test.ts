import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { checkStructure } from "./structure.ts";
import { createProject, FIXTURE_JSON, moduleFiles, type Project } from "../test-support/project.ts";

let project: Project | undefined;
afterEach(() => {
  project?.cleanup();
  project = undefined;
});

function rulesFor(files: Record<string, string>): string[] {
  project = createProject(files);
  return checkStructure(project.root).findings.map((item) => item.rule);
}

const dir = "apps/core-api/src/modules/registry";
const manifest = (overrides: Record<string, unknown>): string =>
  FIXTURE_JSON({
    code: "RG",
    name: "registry",
    title: "Scholar registry",
    dependsOn: [],
    database: { schema: "registry", extraSchemas: [] },
    ...overrides,
  });

test("a valid module passes", () => {
  assert.deepEqual(rulesFor({ ...moduleFiles("core-api", "registry", "RG"), [`${dir}/internal/domain/.gitkeep`]: "" }), []);
});

const cases: { name: string; rule: string; files: Record<string, string> }[] = [
  {
    name: "module.json is missing",
    rule: "module-manifest",
    files: { [`${dir}/index.ts`]: "export {};\n", [`${dir}/module.ts`]: "export {};\n", [`${dir}/README.md`]: "# r\n" },
  },
  {
    name: "module.json is not valid JSON",
    rule: "module-manifest",
    files: { ...moduleFiles("core-api", "registry", "RG"), [`${dir}/module.json`]: "{ nope" },
  },
  {
    name: "the manifest has a bad code",
    rule: "module-manifest",
    files: { ...moduleFiles("core-api", "registry", "RG"), [`${dir}/module.json`]: manifest({ code: "registry" }) },
  },
  {
    name: "the manifest name differs from the folder",
    rule: "module-manifest",
    files: { ...moduleFiles("core-api", "registry", "RG"), [`${dir}/module.json`]: manifest({ name: "other" }) },
  },
  {
    name: "the database schema is not the module name",
    rule: "module-schema",
    files: {
      ...moduleFiles("core-api", "registry", "RG"),
      [`${dir}/module.json`]: manifest({ database: { schema: "shared", extraSchemas: [] } }),
    },
  },
  {
    name: "the public API file is missing",
    rule: "module-layout",
    files: Object.fromEntries(Object.entries(moduleFiles("core-api", "registry", "RG")).filter(([path]) => !path.endsWith("/index.ts"))),
  },
  {
    name: "there is an unexpected file at the module root",
    rule: "module-layout",
    files: { ...moduleFiles("core-api", "registry", "RG"), [`${dir}/helpers.ts`]: "export {};\n" },
  },
  {
    name: "there is an unknown folder inside internal",
    rule: "module-layout",
    files: { ...moduleFiles("core-api", "registry", "RG"), [`${dir}/internal/services/x.ts`]: "export {};\n" },
  },
  {
    name: "there is a file directly inside internal",
    rule: "module-layout",
    files: { ...moduleFiles("core-api", "registry", "RG"), [`${dir}/internal/x.ts`]: "export {};\n" },
  },
  { name: "the module is not in the delivery plan", rule: "module-planned", files: moduleFiles("core-api", "inventory", "IN") },
  {
    name: "the module code differs from the plan",
    rule: "module-planned",
    files: { ...moduleFiles("core-api", "registry", "RG"), [`${dir}/module.json`]: manifest({ code: "ZZ" }) },
  },
  {
    name: "a module depends on itself",
    rule: "module-dependencies",
    files: { ...moduleFiles("core-api", "registry", "RG"), [`${dir}/module.json`]: manifest({ dependsOn: ["registry"] }) },
  },
  {
    name: "a module depends on a module that does not exist",
    rule: "module-dependencies",
    files: { ...moduleFiles("core-api", "registry", "RG"), [`${dir}/module.json`]: manifest({ dependsOn: ["payments"] }) },
  },
  {
    name: "declared dependencies form a cycle",
    rule: "module-dependencies",
    files: {
      ...moduleFiles("core-api", "registry", "RG", ["configuration"]),
      ...moduleFiles("core-api", "configuration", "CF", ["registry"]),
    },
  },
  {
    name: "two modules of one application share a code",
    rule: "module-code-unique",
    files: { ...moduleFiles("core-api", "registry", "RG"), ...moduleFiles("core-api", "configuration", "RG") },
  },
  { name: "a file name is not kebab-case", rule: "file-name", files: { "apps/core-api/src/kernel/MyFile.ts": "export {};\n" } },
  { name: "a component file name is not kebab-case", rule: "file-name", files: { "apps/staff-web/src/MyPage.tsx": "export {};\n" } },
  { name: "a folder name is not kebab-case", rule: "file-name", files: { "apps/core-api/src/kernel/myFolder/x.ts": "export {};\n" } },
];

describe("structure violations are reported", () => {
  for (const item of cases) {
    test(item.name, () => {
      const found = rulesFor(item.files);
      assert.ok(found.includes(item.rule), `expected ${item.rule}, got [${found.join(", ")}]`);
    });
  }
});

test("the same code may be used once in each application", () => {
  assert.deepEqual(rulesFor({ ...moduleFiles("core-api", "sync", "SY"), ...moduleFiles("portal-api", "sync", "SY") }), []);
});

test("file names with .test, .config and .d suffixes are accepted", () => {
  assert.deepEqual(rulesFor({ "apps/core-api/src/kernel/a-b.test.ts": "", "tools/x.config.ts": "", "tools/types.d.ts": "" }), []);
});
