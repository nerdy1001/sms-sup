import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { checkImports } from "./imports.ts";
import { createProject, FIXTURE_JSON, moduleFiles, type Project } from "../test-support/project.ts";

const CORE = "apps/core-api/src";
const PORTAL = "apps/portal-api/src";
const registry = (path: string): string => `${CORE}/modules/registry/${path}`;
const configuration = (path: string): string => `${CORE}/modules/configuration/${path}`;

const twoModules = (dependsOn: string[] = []): Record<string, string> => ({
  ...moduleFiles("core-api", "registry", "RG", dependsOn),
  ...moduleFiles("core-api", "configuration", "CF"),
});

let project: Project | undefined;
afterEach(() => {
  project?.cleanup();
  project = undefined;
});

function run(
  files: Record<string, string>,
  extra: { dependencies?: Record<string, string> } = {},
): { errors: string[]; warnings: string[] } {
  project = createProject({
    ...files,
    ...(extra.dependencies === undefined
      ? {}
      : {
          "apps/core-api/package.json": FIXTURE_JSON({
            name: "@minesup/core-api",
            dependencies: { "@minesup/contracts": "*", ...extra.dependencies },
          }),
        }),
  });
  const { findings } = checkImports(project.root);
  return {
    errors: findings.filter((item) => item.severity === "error").map((item) => item.rule),
    warnings: findings.filter((item) => item.severity === "warning").map((item) => item.rule),
  };
}

describe("a clean project", () => {
  test("passes, including a declared module dependency and type-only cycles", () => {
    const result = run({
      ...twoModules(["configuration"]),
      [configuration("index.ts")]: 'export type Country = string;\nexport const countries = ["CM"];\n',
      [registry("module.ts")]: 'import { countries } from "./index.ts";\nexport const list = countries;\n',
      [registry("internal/application/use-case.ts")]:
        `import { countries } from "../../../configuration/index.ts";\nimport type { Thing } from "../domain/thing.ts";\nexport const run = (t: Thing): number => countries.length + t.id;\n`,
      [registry("internal/domain/thing.ts")]: "export interface Thing { id: number }\n",
      [`${CORE}/kernel/a.ts`]: 'import type { B } from "./b.ts";\nexport interface A { b?: B }\n',
      [`${CORE}/kernel/b.ts`]: 'import type { A } from "./a.ts";\nexport interface B { a?: A }\n',
      [registry("internal/http/routes.ts")]: 'import { run } from "../application/use-case.ts";\nexport const route = run;\n',
    });
    assert.deepEqual(result.errors, []);
  });
});

const violations: { name: string; rule: string; files: Record<string, string>; dependencies?: Record<string, string> }[] = [
  {
    name: "the portal imports staff code by path",
    rule: "zone-isolation",
    files: {
      [`${CORE}/x.ts`]: "export const x = 1;\n",
      [`${PORTAL}/y.ts`]: 'import { x } from "../../core-api/src/x.ts";\nexport const y = x;\n',
    },
  },
  {
    name: "the portal imports the staff application by package name",
    rule: "zone-isolation",
    files: { [`${PORTAL}/y.ts`]: 'import { x } from "@minesup/core-api";\nexport const y = x;\n' },
  },
  {
    name: "a web application imports an API application",
    rule: "zone-isolation",
    files: {
      "apps/staff-web/package.json": FIXTURE_JSON({ name: "@minesup/staff-web" }),
      [`${CORE}/x.ts`]: "export const x = 1;\n",
      "apps/staff-web/src/y.ts": 'import { x } from "../../core-api/src/x.ts";\nexport const y = x;\n',
    },
  },
  {
    name: "a package imports application code",
    rule: "package-no-app-import",
    files: {
      [`${CORE}/x.ts`]: "export const x = 1;\n",
      "packages/contracts/src/a.ts": 'import { x } from "../../../apps/core-api/src/x.ts";\nexport const a = x;\n',
    },
  },
  {
    name: "an application reaches into a package source by path",
    rule: "no-deep-package-import",
    files: { [`${CORE}/x.ts`]: 'import { z } from "../../../packages/contracts/src/index.ts";\nexport const x = z;\n' },
  },
  {
    name: "a module imports the internals of another module",
    rule: "module-public-api",
    files: {
      ...twoModules(["configuration"]),
      [configuration("internal/domain/c.ts")]: "export const c = 1;\n",
      [registry("module.ts")]: 'import { c } from "../configuration/internal/domain/c.ts";\nexport const r = c;\n',
    },
  },
  {
    name: "a module imports another module that it did not declare",
    rule: "module-declared-dependency",
    files: {
      ...twoModules(),
      [configuration("index.ts")]: "export const c = 1;\n",
      [registry("module.ts")]: 'import { c } from "../configuration/index.ts";\nexport const r = c;\n',
    },
  },
  {
    name: "the entry point imports module internals",
    rule: "module-public-api",
    files: {
      ...twoModules(),
      [configuration("internal/domain/c.ts")]: "export const c = 1;\n",
      [`${CORE}/main.ts`]: 'import { c } from "./modules/configuration/internal/domain/c.ts";\nexport const m = c;\n',
    },
  },
  {
    name: "the kernel imports a module",
    rule: "kernel-isolation",
    files: {
      ...twoModules(),
      [configuration("index.ts")]: "export const c = 1;\n",
      [`${CORE}/kernel/k.ts`]: 'import { c } from "../modules/configuration/index.ts";\nexport const k = c;\n',
    },
  },
  {
    name: "a module imports the application entry point",
    rule: "no-import-app-root",
    files: {
      ...twoModules(),
      [`${CORE}/main.ts`]: "export const m = 1;\n",
      [registry("module.ts")]: 'import { m } from "../../main.ts";\nexport const r = m;\n',
    },
  },
  {
    name: "the domain layer imports the infrastructure layer",
    rule: "layer-direction",
    files: {
      ...twoModules(),
      [registry("internal/infrastructure/db.ts")]: "export const db = 1;\n",
      [registry("internal/domain/d.ts")]: 'import { db } from "../infrastructure/db.ts";\nexport const d = db;\n',
    },
  },
  {
    name: "the http layer imports the infrastructure layer directly",
    rule: "layer-direction",
    files: {
      ...twoModules(),
      [registry("internal/infrastructure/db.ts")]: "export const db = 1;\n",
      [registry("internal/http/h.ts")]: 'import { db } from "../infrastructure/db.ts";\nexport const h = db;\n',
    },
  },
  {
    name: "a layer imports the module root",
    rule: "layer-direction",
    files: {
      ...twoModules(),
      [registry("internal/application/a.ts")]: 'import { x } from "../../module.ts";\nexport const a = x;\n',
      [registry("module.ts")]: "export const x = 1;\n",
    },
  },
  {
    name: "the domain layer uses a Node module",
    rule: "layer-purity",
    files: {
      ...twoModules(),
      [registry("internal/domain/d.ts")]: 'import { randomUUID } from "node:crypto";\nexport const d = randomUUID;\n',
    },
  },
  {
    name: "the application layer uses an external library",
    rule: "layer-purity",
    dependencies: { lodash: "4.17.21" },
    files: { ...twoModules(), [registry("internal/application/a.ts")]: 'import lodash from "lodash";\nexport const a = lodash;\n' },
  },
  {
    name: "the contracts package uses a Node module",
    rule: "contracts-purity",
    files: { "packages/contracts/src/c.ts": 'import { readFileSync } from "node:fs";\nexport const c = readFileSync;\n' },
  },
  {
    name: "the contracts package uses a library other than the allowed one",
    rule: "contracts-purity",
    files: {
      "packages/contracts/package.json": FIXTURE_JSON({
        name: "@minesup/contracts",
        exports: { ".": "./src/index.ts" },
        dependencies: { lodash: "4.17.21" },
      }),
      "packages/contracts/src/c.ts": 'import lodash from "lodash";\nexport const c = lodash;\n',
    },
  },
  {
    name: "application code starts a child process",
    rule: "forbidden-builtin",
    files: { [`${CORE}/kernel/k.ts`]: 'import { exec } from "node:child_process";\nexport const k = exec;\n' },
  },
  {
    name: "a business module opens network connections",
    rule: "network-egress",
    files: {
      ...twoModules(),
      [registry("internal/infrastructure/net.ts")]: 'import { request } from "node:https";\nexport const n = request;\n',
    },
  },
  {
    name: "a business module imports a network library",
    rule: "network-egress",
    dependencies: { axios: "1.0.0" },
    files: { ...twoModules(), [registry("internal/application/a.ts")]: 'import axios from "axios";\nexport const a = axios;\n' },
  },
  {
    name: "a database driver is used outside the infrastructure layer",
    rule: "database-driver",
    dependencies: { pg: "8.0.0" },
    files: { ...twoModules(), [registry("internal/http/h.ts")]: 'import pg from "pg";\nexport const h = pg;\n' },
  },
  {
    name: "a library is not declared in package.json",
    rule: "undeclared-dependency",
    files: { [`${CORE}/kernel/k.ts`]: 'import something from "something";\nexport const k = something;\n' },
  },
  {
    name: "a library is only declared as a dev dependency but used in production code",
    rule: "undeclared-dependency",
    files: {
      "apps/core-api/package.json": FIXTURE_JSON({
        name: "@minesup/core-api",
        dependencies: { "@minesup/contracts": "*" },
        devDependencies: { vitest: "1.0.0" },
      }),
      [`${CORE}/kernel/k.ts`]: 'import vitest from "vitest";\nexport const k = vitest;\n',
    },
  },
  {
    name: "production code imports a test file",
    rule: "test-import",
    files: {
      [`${CORE}/kernel/helpers.test.ts`]: "export const t = 1;\n",
      [`${CORE}/kernel/k.ts`]: 'import { t } from "./helpers.test.ts";\nexport const k = t;\n',
    },
  },
  {
    name: "two files import each other at runtime",
    rule: "circular-import",
    files: {
      [`${CORE}/kernel/a.ts`]: 'import { b } from "./b.ts";\nexport const a = () => b;\n',
      [`${CORE}/kernel/b.ts`]: 'import { a } from "./a.ts";\nexport const b = () => a;\n',
    },
  },
  {
    name: "an import path is computed",
    rule: "no-computed-import",
    files: { [`${CORE}/kernel/k.ts`]: 'const name = "./x.ts";\nexport const k = await import(name);\n' },
  },
  {
    name: "require is used",
    rule: "no-require",
    files: { [`${CORE}/kernel/x.ts`]: "export const x = 1;\n", [`${CORE}/kernel/k.ts`]: 'export const k = require("./x.ts");\n' },
  },
  {
    name: "an import does not resolve",
    rule: "unresolved-import",
    files: { [`${CORE}/kernel/k.ts`]: 'import { z } from "./missing.ts";\nexport const k = z;\n' },
  },
  {
    name: "an import omits the file extension",
    rule: "unresolved-import",
    files: { [`${CORE}/kernel/x.ts`]: "export const x = 1;\n", [`${CORE}/kernel/k.ts`]: 'import { x } from "./x";\nexport const k = x;\n' },
  },
];

describe("violations are reported", () => {
  for (const item of violations) {
    test(item.name, () => {
      const result = run(item.files, item.dependencies === undefined ? {} : { dependencies: item.dependencies });
      assert.ok(result.errors.includes(item.rule), `expected rule ${item.rule}, got [${result.errors.join(", ")}]`);
    });
  }
});

describe("exceptions that the rules allow", () => {
  test("network code is allowed in the kernel server, the sync and notification infrastructure and main.ts", () => {
    const result = run({
      ...moduleFiles("core-api", "sync", "SY"),
      ...moduleFiles("core-api", "notifications", "NT"),
      [`${CORE}/main.ts`]: 'import { createServer } from "node:http";\nexport const m = createServer;\n',
      [`${CORE}/kernel/http/server.ts`]: 'import { createServer } from "node:http";\nexport const s = createServer;\n',
      [`${CORE}/modules/sync/internal/infrastructure/client.ts`]: 'import { request } from "node:https";\nexport const c = request;\n',
      [`${CORE}/modules/notifications/internal/infrastructure/mail.ts`]: 'import { connect } from "node:tls";\nexport const m = connect;\n',
    });
    assert.deepEqual(result.errors, []);
  });

  test("the contracts package may use the test runner and assertions in its tests, and nothing else from Node", () => {
    const passing = run({
      "packages/contracts/src/c.test.ts":
        'import assert from "node:assert/strict";\nimport { test } from "node:test";\ntest("x", () => assert.ok(true));\n',
    });
    assert.deepEqual(passing.errors, []);
    const failing = run({
      "packages/contracts/src/c.test.ts": 'import { readFileSync } from "node:fs";\nexport const c = readFileSync;\n',
    });
    assert.deepEqual(failing.errors, ["contracts-purity"]);
  });

  test("database drivers are allowed in infrastructure and tests may use test tooling", () => {
    const result = run(
      {
        ...twoModules(),
        [registry("internal/infrastructure/repo.ts")]: 'import pg from "pg";\nexport const r = pg;\n',
        [registry("internal/domain/rules.test.ts")]:
          'import { createServer } from "node:http";\nimport { test } from "node:test";\ntest("x", () => createServer);\n',
      },
      { dependencies: { pg: "8.0.0" } },
    );
    assert.deepEqual(result.errors, []);
  });

  test("web applications may use browser networking libraries", () => {
    const result = run({
      "apps/staff-web/package.json": FIXTURE_JSON({ name: "@minesup/staff-web", dependencies: { axios: "1.0.0" } }),
      "apps/staff-web/src/api.ts": 'import axios from "axios";\nexport const api = axios;\n',
    });
    assert.deepEqual(result.errors, []);
  });
});

test("a declared dependency that no code uses is only a warning", () => {
  const result = run(twoModules(["configuration"]));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, ["unused-declared-dependency"]);
});

describe("web applications (files with JSX)", () => {
  const WEB = "apps/staff-web/src";
  const webProject = (files: Record<string, string>, dependencies: Record<string, string> = {}) => {
    project = createProject({
      "apps/staff-web/package.json": FIXTURE_JSON({
        name: "@minesup/staff-web",
        dependencies: { "@minesup/contracts": "*", ...dependencies },
      }),
      ...files,
    });
    const { findings } = checkImports(project.root);
    return findings.filter((item) => item.severity === "error").map((item) => item.rule);
  };

  test("a component that imports another component and its style sheet passes", () => {
    assert.deepEqual(
      webProject({
        [`${WEB}/main.tsx`]: 'import { Page } from "./page.tsx";\nimport "./styles.css";\nexport const Root = () => <Page />;\n',
        [`${WEB}/page.tsx`]: "export const Page = () => <p>x</p>;\n",
        [`${WEB}/styles.css`]: "body {}\n",
      }),
      [],
    );
  });

  test("a style sheet that does not exist is an unresolved import", () => {
    assert.deepEqual(webProject({ [`${WEB}/main.tsx`]: 'import "./missing.css";\nexport const x = 1;\n' }), ["unresolved-import"]);
  });

  test("a component that does not exist is an unresolved import", () => {
    assert.deepEqual(webProject({ [`${WEB}/main.tsx`]: 'import { Page } from "./page.tsx";\nexport const Root = () => <Page />;\n' }), [
      "unresolved-import",
    ]);
  });

  test("a library that is not declared is refused in a component too", () => {
    assert.deepEqual(webProject({ [`${WEB}/page.tsx`]: 'import { clsx } from "clsx";\nexport const x = clsx("a");\n' }), [
      "undeclared-dependency",
    ]);
    assert.deepEqual(
      webProject({ [`${WEB}/page.tsx`]: 'import { clsx } from "clsx";\nexport const x = clsx("a");\n' }, { clsx: "2.1.1" }),
      [],
    );
  });

  test("the staff front end may not import the staff API, nor the portal front end", () => {
    const bad = webProject({
      [`${CORE}/kernel/x.ts`]: "export const x = 1;\n",
      [`${WEB}/page.tsx`]: 'import { x } from "../../core-api/src/kernel/x.ts";\nexport const y = x;\n',
    });
    assert.deepEqual(bad, ["zone-isolation"]);
  });

  test("a test file written for vitest may import a library that is only a development dependency", () => {
    assert.deepEqual(webProject({ [`${WEB}/page.spec.tsx`]: 'import { test } from "vitest";\ntest("x", () => {});\n' }), [
      "undeclared-dependency",
    ]);
    project?.cleanup();
    project = createProject({
      "apps/staff-web/package.json": FIXTURE_JSON({
        name: "@minesup/staff-web",
        dependencies: { "@minesup/contracts": "*" },
        devDependencies: { vitest: "5.1.0" },
      }),
      [`${WEB}/page.spec.tsx`]: 'import { test } from "vitest";\ntest("x", () => {});\n',
    });
    assert.deepEqual(
      checkImports(project.root).findings.filter((item) => item.severity === "error"),
      [],
    );
  });
});
