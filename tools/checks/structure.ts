import { listDirectories, listEntries, listFiles } from "../lib/files.ts";
import { LAYERS, snakeCase } from "../lib/layout.ts";
import { discoverModules, type ModuleInfo } from "../lib/modules.ts";
import { finding, type CheckResult, type Finding } from "../lib/model.ts";
import { plannedModules } from "../rules.config.ts";

const ALLOWED_MODULE_ENTRIES = ["module.json", "index.ts", "module.ts", "module.test.ts", "README.md", "internal", "migrations"];
const REQUIRED_MODULE_FILES = ["index.ts", "module.ts", "README.md"];
const FILE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.(?:test|spec|config|d))?\.tsx?$/;
const DIRECTORY_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function checkStructure(root: string): CheckResult {
  const findings: Finding[] = [];
  const modules = discoverModules(root);
  const seenCodes = new Map<string, string>();

  for (const info of modules) {
    checkModule(root, info, findings);
    if (info.manifest !== undefined) {
      const key = `${info.app}:${info.manifest.code}`;
      const other = seenCodes.get(key);
      if (other !== undefined) {
        findings.push(
          finding(
            "module-code-unique",
            `${info.dir}/module.json`,
            `Code ${info.manifest.code} is already used by ${other} in ${info.app}.`,
          ),
        );
      }
      seenCodes.set(key, info.dir);
    }
  }
  checkDependencies(modules, findings);
  checkNames(root, findings);
  return { findings, suppressions: [] };
}

function checkModule(root: string, info: ModuleInfo, findings: Finding[]): void {
  const report = (rule: string, message: string, file = `${info.dir}/module.json`): void => {
    findings.push(finding(rule, file, message));
  };

  for (const problem of info.manifestProblems) report("module-manifest", problem);

  for (const required of REQUIRED_MODULE_FILES) {
    if (!info.entries.includes(required)) {
      report("module-layout", `Missing ${required}. Create modules with "npm run new:module".`, `${info.dir}/${required}`);
    }
  }
  for (const entry of info.entries) {
    if (!ALLOWED_MODULE_ENTRIES.includes(entry)) {
      report(
        "module-layout",
        `Unexpected "${entry}" at the module root. Code belongs in internal/<layer>/. Allowed at the root: ${ALLOWED_MODULE_ENTRIES.join(", ")}.`,
        `${info.dir}/${entry}`,
      );
    }
  }
  if (info.entries.includes("internal")) {
    for (const entry of listEntries(root, `${info.dir}/internal`)) {
      const isLayer = (LAYERS as readonly string[]).includes(entry) && listDirectories(root, `${info.dir}/internal`).includes(entry);
      if (!isLayer) {
        report(
          "module-layout",
          `"internal/${entry}" is not a layer folder. Allowed: ${LAYERS.join(", ")}.`,
          `${info.dir}/internal/${entry}`,
        );
      }
    }
  }

  const manifest = info.manifest;
  if (manifest === undefined) return;

  if (manifest.name !== info.name) report("module-manifest", `"name" is "${manifest.name}" but the folder is "${info.name}".`);
  if (manifest.database.schema !== snakeCase(info.name)) {
    report(
      "module-schema",
      `The database schema of module "${info.name}" must be "${snakeCase(info.name)}" (found "${manifest.database.schema}").`,
    );
  }
  const planned = plannedModules.find((entry) => entry.app === info.app && entry.name === info.name);
  if (planned === undefined) {
    report(
      "module-planned",
      `Module "${info.name}" is not in the delivery plan for ${info.app}. Add it to plannedModules in tools/rules.config.ts and to docs/architecture/modules.md first.`,
    );
  } else if (planned.code !== manifest.code) {
    report("module-planned", `Module "${info.name}" has code ${manifest.code} but the plan says ${planned.code}.`);
  }
}

function checkDependencies(modules: readonly ModuleInfo[], findings: Finding[]): void {
  for (const app of new Set(modules.map((info) => info.app))) {
    const inApp = modules.filter((info) => info.app === app && info.manifest !== undefined);
    const names = new Set(inApp.map((info) => info.name));
    const graph = new Map(inApp.map((info) => [info.name, [...(info.manifest?.dependsOn ?? [])]]));

    for (const info of inApp) {
      for (const dependency of info.manifest?.dependsOn ?? []) {
        if (dependency === info.name) {
          findings.push(finding("module-dependencies", `${info.dir}/module.json`, "A module cannot depend on itself."));
        } else if (!names.has(dependency)) {
          findings.push(
            finding("module-dependencies", `${info.dir}/module.json`, `dependsOn lists "${dependency}", which is not a module of ${app}.`),
          );
        }
      }
    }

    const state = new Map<string, "visiting" | "done">();
    const path: string[] = [];
    const visit = (name: string): void => {
      if (state.get(name) === "done") return;
      if (state.get(name) === "visiting") {
        const cycle = [...path.slice(path.indexOf(name)), name];
        findings.push(
          finding(
            "module-dependencies",
            `apps/${app}/src/modules/${name}/module.json`,
            `Circular module dependency: ${cycle.join(" -> ")}. Break the cycle (for example with an event) instead of declaring it.`,
          ),
        );
        return;
      }
      state.set(name, "visiting");
      path.push(name);
      for (const next of graph.get(name) ?? []) {
        if (names.has(next) && next !== name) visit(next);
      }
      path.pop();
      state.set(name, "done");
    };
    for (const name of [...names].sort()) visit(name);
  }
}

function checkNames(root: string, findings: Finding[]): void {
  const groups = ["apps", "packages", "tools"];
  for (const group of groups) {
    for (const file of listFiles(root, group)) {
      if (!/\.tsx?$/.test(file)) continue;
      const name = file.split("/").pop() ?? file;
      if (!FILE_NAME.test(name)) {
        findings.push(finding("file-name", file, `File names are lowercase kebab-case ("${name}").`));
      }
    }
  }
  const walk = (relativeDir: string): void => {
    for (const name of listDirectories(root, relativeDir)) {
      if (name === "node_modules" || name === "dist" || name === "coverage") continue;
      const path = `${relativeDir}/${name}`;
      if (!DIRECTORY_NAME.test(name)) {
        findings.push(finding("file-name", path, `Folder names are lowercase kebab-case ("${name}").`));
      }
      walk(path);
    }
  };
  for (const group of groups) walk(group);
}
