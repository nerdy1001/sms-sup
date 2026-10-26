import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export interface Project {
  readonly root: string;
  write(path: string, content: string): void;
  cleanup(): void;
}

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** A minimal repository with both applications and the contracts package. */
export const BASE_FILES: Readonly<Record<string, string>> = {
  "package.json": json({ name: "fixture", private: true, devDependencies: { typescript: "6.0.3" } }),
  "apps/core-api/package.json": json({ name: "@minesup/core-api", dependencies: { "@minesup/contracts": "*" } }),
  "apps/portal-api/package.json": json({ name: "@minesup/portal-api", dependencies: { "@minesup/contracts": "*" } }),
  "packages/contracts/package.json": json({ name: "@minesup/contracts", exports: { ".": "./src/index.ts" }, dependencies: {} }),
  "packages/contracts/src/index.ts": "export {};\n",
};

export function createProject(extra: Readonly<Record<string, string>> = {}): Project {
  const root = mkdtempSync(join(tmpdir(), "minesup-fixture-"));
  const project: Project = {
    root,
    write(path, content) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
  for (const [path, content] of Object.entries({ ...BASE_FILES, ...extra })) project.write(path, content);
  return project;
}

/** The files of a valid module. `app` is the application folder, for example "core-api". */
export function moduleFiles(app: string, name: string, code: string, dependsOn: readonly string[] = []): Record<string, string> {
  const dir = `apps/${app}/src/modules/${name}`;
  return {
    [`${dir}/module.json`]: json({ code, name, title: name, dependsOn, database: { schema: name.replaceAll("-", "_"), extraSchemas: [] } }),
    [`${dir}/index.ts`]: "export {};\n",
    [`${dir}/module.ts`]: "export {};\n",
    [`${dir}/README.md`]: `# ${name}\n`,
  };
}

export const FIXTURE_JSON = json;
