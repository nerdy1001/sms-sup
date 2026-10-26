import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { listDirectories } from "./lib/files.ts";
import { LAYERS, pascalCase, snakeCase } from "./lib/layout.ts";
import { plannedModules, type PlannedModule } from "./rules.config.ts";

export interface ScaffoldOptions {
  readonly app?: string;
  readonly dependsOn?: readonly string[];
}

function resolvePlanned(code: string, app: string | undefined): PlannedModule {
  const matches = plannedModules.filter((entry) => entry.code === code.toUpperCase() && (app === undefined || entry.app === app));
  const [first] = matches;
  if (first === undefined) {
    const known = plannedModules.map((entry) => `${entry.code} (${entry.name}, ${entry.app})`).join(", ");
    throw new Error(`No planned module with code "${code}"${app === undefined ? "" : ` in ${app}`}. Planned modules: ${known}. To add one, edit tools/rules.config.ts and docs/architecture/modules.md first.`);
  }
  if (matches.length > 1) {
    throw new Error(`Code ${code} exists in several applications (${matches.map((entry) => entry.app).join(", ")}). Add --app <name>.`);
  }
  return first;
}

/** Creates a module folder with the standard layout. Returns the files it wrote, root-relative. */
export function scaffoldModule(root: string, code: string, options: ScaffoldOptions = {}): string[] {
  const planned = resolvePlanned(code, options.app);
  const dir = `apps/${planned.app}/src/modules/${planned.name}`;
  if (existsSync(join(root, dir))) throw new Error(`${dir} already exists.`);

  const dependsOn = [...(options.dependsOn ?? [])];
  const existing = listDirectories(root, `apps/${planned.app}/src/modules`);
  for (const dependency of dependsOn) {
    if (!existing.includes(dependency)) {
      throw new Error(`Cannot depend on "${dependency}": no such module in ${planned.app} yet. Create it first.`);
    }
  }

  const pascal = pascalCase(planned.name);
  const manifest = {
    code: planned.code,
    name: planned.name,
    title: planned.title,
    dependsOn,
    database: { schema: snakeCase(planned.name), extraSchemas: [] as string[] },
  };

  const files: Record<string, string> = {
    "module.json": `${JSON.stringify(manifest, null, 2)}\n`,
    "index.ts": [
      `// Public API of the ${planned.title} module (${planned.code}).`,
      "// Other modules may import only from this file. Export types and factory functions,",
      "// never anything from internal/.",
      `export { create${pascal}Module } from "./module.ts";`,
      `export type { ${pascal}Dependencies, ${pascal}Module } from "./module.ts";`,
      "",
    ].join("\n"),
    "module.ts": [
      `// Composition root of the ${planned.title} module (${planned.code}).`,
      "// The only place where the layers of this module are wired together. Everything the module",
      "// needs from outside arrives through its dependencies, so tests can pass fakes.",
      "",
      `export interface ${pascal}Dependencies {}`,
      "",
      `export interface ${pascal}Module {`,
      `  readonly code: "${planned.code}";`,
      "}",
      "",
      `export function create${pascal}Module(_dependencies: ${pascal}Dependencies): ${pascal}Module {`,
      `  return { code: "${planned.code}" };`,
      "}",
      "",
    ].join("\n"),
    "module.test.ts": [
      'import assert from "node:assert/strict";',
      'import { test } from "node:test";',
      `import { create${pascal}Module } from "./index.ts";`,
      "",
      `test("the ${planned.name} module can be created", () => {`,
      `  assert.equal(create${pascal}Module({}).code, "${planned.code}");`,
      "});",
      "",
    ].join("\n"),
    "README.md": [
      `# ${planned.title} (${planned.code})`,
      "",
      "Purpose: describe in one or two sentences what this module owns.",
      "",
      `- Database schema: \`${snakeCase(planned.name)}\` (no other module reads or writes it directly)`,
      `- Depends on: ${dependsOn.length === 0 ? "nothing yet" : dependsOn.join(", ")} (declared in \`module.json\`)`,
      `- Tasks: ${planned.code}-01 onwards, see the delivery plan`,
      "",
      "Layers: `internal/domain` (rules, no libraries), `internal/application` (use cases),",
      "`internal/infrastructure` (database, files, network), `internal/http` (routes and validation).",
      "See docs/boundaries.md for what each layer may import.",
      "",
    ].join("\n"),
  };
  for (const layer of LAYERS) files[`internal/${layer}/.gitkeep`] = "";

  const written: string[] = [];
  for (const [name, content] of Object.entries(files)) {
    const path = `${dir}/${name}`;
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
    written.push(path);
  }
  return written;
}

function main(): void {
  const args = process.argv.slice(2);
  const option = (name: string): string | undefined => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const code = args[0];
  if (code === undefined || code.startsWith("--")) {
    console.error("Usage: npm run new:module -- <CODE> [--depends a,b] [--app core-api|portal-api]");
    process.exitCode = 2;
    return;
  }
  try {
    const dependsOnArgument = option("--depends");
    const options: ScaffoldOptions = {
      ...(option("--app") === undefined ? {} : { app: option("--app") as string }),
      dependsOn: dependsOnArgument === undefined || dependsOnArgument === "" ? [] : dependsOnArgument.split(","),
    };
    const written = scaffoldModule(resolve("."), code, options);
    console.log(`Created ${written.length} files:\n${written.map((path) => `  ${path}`).join("\n")}`);
    console.log("\nNext: add the module to docs/architecture/modules.md if its dependencies changed, then run: npm run check");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
