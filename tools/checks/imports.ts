import { builtinModules } from "node:module";
import { posix } from "node:path";
import { fileExists, listFiles, readText } from "../lib/files.ts";
import { parseSource, scanImports, type ImportRef } from "../lib/imports.ts";
import { LAYERS, locate, type Layer, type Where } from "../lib/layout.ts";
import { discoverModules } from "../lib/modules.ts";
import { finding, type CheckResult, type Finding } from "../lib/model.ts";
import { loadWorkspace, type PackageInfo } from "../lib/workspace.ts";
import { rules } from "../rules.config.ts";

type Target =
  | { readonly kind: "relative"; readonly path: string }
  | { readonly kind: "builtin"; readonly base: string }
  | { readonly kind: "workspace"; readonly info: PackageInfo; readonly deep: boolean }
  | { readonly kind: "asset" }
  | { readonly kind: "external"; readonly name: string }
  | { readonly kind: "unresolved" };

/** What each layer inside a module may import from the same module. */
const LAYER_MAY_IMPORT: Readonly<Record<Layer, readonly Layer[]>> = {
  domain: ["domain"],
  application: ["domain", "application"],
  infrastructure: ["domain", "application", "infrastructure"],
  http: ["domain", "application", "http"],
};

function packageNameOf(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier);
}

function appOf(where: Where): string | undefined {
  return where.kind === "module" || where.kind === "kernel" || where.kind === "app" ? where.app : undefined;
}

function matchesAny(path: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(path));
}

function inScope(file: string): boolean {
  return /\.tsx?$/.test(file) && !file.endsWith(".d.ts") && /^(apps|packages)\/[^/]+\/src\//.test(file);
}

export function checkImports(root: string): CheckResult {
  const findings: Finding[] = [];
  const workspace = loadWorkspace(root);
  const modules = discoverModules(root);
  const manifests = new Map(modules.flatMap((m) => (m.manifest ? [[`${m.app}:${m.name}`, m.manifest] as const] : [])));
  const usedDependencies = new Set<string>();
  const graph = new Map<string, string[]>();

  const files = [...listFiles(root, "apps"), ...listFiles(root, "packages")].filter(inScope);

  for (const file of files) {
    const where = locate(file);
    const owner = workspace.ownerOf(file);
    const scan = scanImports(parseSource(file, readText(root, file)));
    const report = (rule: string, line: number | undefined, message: string, severity: "error" | "warning" = "error"): void => {
      findings.push(finding(rule, file, message, line, severity));
    };

    for (const computed of scan.computed) {
      report(
        "no-computed-import",
        computed.line,
        `${computed.kind === "dynamic" ? "import()" : "require()"} with a computed path hides a dependency from the boundary checks. Use a fixed string.`,
      );
    }

    for (const ref of scan.imports) {
      if (ref.kind === "require") {
        report("no-require", ref.line, `require("${ref.specifier}") is not allowed; this project uses ES modules (import).`);
      }
      const target = classify(root, file, ref, workspace.byName);
      applyRules(file, where, owner, ref, target, report);
      if (target.kind === "relative" && !ref.typeOnly) {
        const edges = graph.get(file) ?? [];
        edges.push(target.path);
        graph.set(file, edges);
      }
    }
  }

  function applyRules(
    file: string,
    where: Where,
    owner: PackageInfo,
    ref: ImportRef,
    target: Target,
    report: (rule: string, line: number | undefined, message: string, severity?: "error" | "warning") => void,
  ): void {
    const fromApp = appOf(where);
    const line = ref.line;

    if (target.kind === "asset") return;

    if (target.kind === "unresolved") {
      report(
        "unresolved-import",
        line,
        `"${ref.specifier}" does not resolve to a file. Check the path and write the .ts or .tsx extension.`,
      );
      return;
    }

    if (target.kind === "relative") {
      const targetPath = target.path;
      const targetWhere = locate(targetPath);
      const targetApp = appOf(targetWhere);

      if (!ref.typeOnly && !where.test && targetWhere.test) {
        report("test-import", line, `Production code must not import a test file (${targetPath}).`);
      }

      // Zones and packages.
      if (fromApp !== undefined && targetApp !== undefined && fromApp !== targetApp) {
        const sameZone = Object.values(rules.zones).some((zone: readonly string[]) => zone.includes(fromApp) && zone.includes(targetApp));
        report(
          "zone-isolation",
          line,
          sameZone
            ? `${fromApp} must not import code from ${targetApp}. Applications never import each other; shared data shapes go in packages/contracts.`
            : `${fromApp} must never import code from ${targetApp}: they run in different security zones. Shared data shapes go in packages/contracts.`,
        );
        return;
      }
      if (where.kind === "package" && targetApp !== undefined) {
        report("package-no-app-import", line, `Package code must not import application code (${targetPath}).`);
        return;
      }
      if (targetWhere.kind === "package" && !(where.kind === "package" && where.name === targetWhere.name)) {
        report("no-deep-package-import", line, `Import the package by its name, not by a path into its source (${targetPath}).`);
        return;
      }
      if (fromApp === undefined || targetApp === undefined) return;

      // Inside one application.
      if (where.kind === "kernel" && (targetWhere.kind === "module" || targetWhere.kind === "app")) {
        report(
          "kernel-isolation",
          line,
          `The kernel must not depend on modules or on the application entry point (${targetPath}). Modules depend on the kernel, never the reverse.`,
        );
        return;
      }
      if (where.kind === "module" && targetWhere.kind === "app") {
        report("no-import-app-root", line, `A module must not import the application entry point (${targetPath}).`);
        return;
      }
      if ((where.kind === "module" || where.kind === "app") && targetWhere.kind === "module") {
        const isPublicApi = targetPath === `apps/${targetApp}/src/modules/${targetWhere.module}/index.ts`;
        const sameModule = where.kind === "module" && where.module === targetWhere.module;
        if (!sameModule) {
          if (!isPublicApi) {
            report(
              "module-public-api",
              line,
              `Import the "${targetWhere.module}" module through its public API (modules/${targetWhere.module}/index.ts), not through ${targetPath}.`,
            );
            return;
          }
          if (where.kind === "module") {
            const manifest = manifests.get(`${fromApp}:${where.module}`);
            if (manifest !== undefined && !manifest.dependsOn.includes(targetWhere.module)) {
              report(
                "module-declared-dependency",
                line,
                `Module "${where.module}" imports module "${targetWhere.module}" but does not declare it. Add "${targetWhere.module}" to dependsOn in its module.json (a deliberate, reviewed change).`,
              );
            }
            if (!where.test) usedDependencies.add(`${fromApp}:${where.module}>${targetWhere.module}`);
          }
          return;
        }
        // Same module: layering.
        if (where.layer in LAYER_MAY_IMPORT) {
          const fromLayer = where.layer as Layer;
          if (targetWhere.layer === "root" && !where.test) {
            report(
              "layer-direction",
              line,
              `The ${fromLayer} layer must not import the module root (${targetPath}); the root wires the layers, never the reverse.`,
            );
          } else if ((LAYERS as readonly string[]).includes(targetWhere.layer)) {
            const toLayer = targetWhere.layer as Layer;
            if (!LAYER_MAY_IMPORT[fromLayer].includes(toLayer)) {
              report(
                "layer-direction",
                line,
                `The ${fromLayer} layer must not import the ${toLayer} layer. Allowed: ${LAYER_MAY_IMPORT[fromLayer].join(", ")}.`,
              );
            }
          }
        }
      }
      return;
    }

    if (target.kind === "builtin") {
      const { base } = target;
      if ((rules.forbiddenBuiltins as readonly string[]).includes(base)) {
        report("forbidden-builtin", line, `"node:${base}" is not allowed in application code (it can run arbitrary programs or code).`);
      }
      checkNetwork(file, where, line, base, "builtins", report);
      if (
        where.kind === "module" &&
        !where.test &&
        (where.layer === "domain" || where.layer === "application") &&
        !rules.pureLayerAllowedExternal.includes(`node:${base}`)
      ) {
        report(
          "layer-purity",
          line,
          `The ${where.layer} layer must stay free of Node modules ("node:${base}"). Put technical code in the infrastructure layer or the kernel.`,
        );
      }
      // The shapes themselves use no Node module. Their tests may use the test runner and assertions.
      const testTooling = where.kind === "package" && where.test && (rules.contracts.allowedInTests as readonly string[]).includes(base);
      if (where.kind === "package" && where.name === "contracts" && !testTooling) {
        report("contracts-purity", line, `packages/contracts must not use Node modules ("node:${base}").`);
      }
      return;
    }

    if (target.kind === "workspace") {
      if (target.deep) {
        report("no-deep-package-import", line, `Import "${target.info.name}" by its name only, without a sub-path.`);
      }
      if (target.info.dir.startsWith("apps/")) {
        report(
          "zone-isolation",
          line,
          `Applications must not import another application ("${target.info.name}"). Shared data shapes go in packages/contracts.`,
        );
        return;
      }
      if (where.kind === "package" && where.name === "contracts" && target.info.name !== rules.contracts.packageName) {
        report("contracts-purity", line, `packages/contracts must not depend on other packages ("${target.info.name}").`);
      }
      if (
        target.info.name !== owner.name &&
        !owner.dependencies.has(target.info.name) &&
        !(where.test && owner.devDependencies.has(target.info.name))
      ) {
        report("undeclared-dependency", line, `"${target.info.name}" is not listed in dependencies of ${owner.dir}/package.json.`);
      }
      return;
    }

    // External npm package.
    const name = target.name;
    checkNetwork(file, where, line, name, "packages", report);
    if ((rules.database.drivers as readonly string[]).includes(name) && !matchesAny(file, rules.database.allowedPaths)) {
      report("database-driver", line, `Database driver "${name}" may only be used in a module's infrastructure layer or in kernel/db.`);
    }
    if (
      where.kind === "module" &&
      !where.test &&
      (where.layer === "domain" || where.layer === "application") &&
      !rules.pureLayerAllowedExternal.includes(name)
    ) {
      report(
        "layer-purity",
        line,
        `The ${where.layer} layer must stay free of external libraries ("${name}"). Put technical code in the infrastructure layer or the kernel.`,
      );
    }
    if (where.kind === "package" && where.name === "contracts" && !(rules.contracts.allowedExternal as readonly string[]).includes(name)) {
      report(
        "contracts-purity",
        line,
        `packages/contracts may only depend on: ${rules.contracts.allowedExternal.join(", ")} ("${name}" is not allowed).`,
      );
    }
    const declared = owner.dependencies.has(name) || (where.test && owner.devDependencies.has(name));
    if (!declared) {
      report(
        "undeclared-dependency",
        line,
        `"${name}" is not listed in ${where.test ? "dependencies or devDependencies" : "dependencies"} of ${owner.dir}/package.json. Add it (with an exact version) and say why in the pull request.`,
      );
    }
  }

  function checkNetwork(
    file: string,
    where: Where,
    line: number,
    name: string,
    list: "builtins" | "packages",
    report: (rule: string, line: number | undefined, message: string, severity?: "error" | "warning") => void,
  ): void {
    if (where.test) return;
    if (!(rules.egress[list] as readonly string[]).includes(name)) return;
    const app = appOf(where);
    if (app !== undefined && !(app in rules.egress.allowedPaths)) return; // web applications run in a browser
    const allowed = app === undefined ? [] : (rules.egress.allowedPaths[app] ?? []);
    if (!matchesAny(file, allowed)) {
      report(
        "network-egress",
        line,
        `"${name}" opens or uses network connections. It is only allowed in the HTTP server kernel, the mail and sync infrastructure, and main.ts (see docs/boundaries.md).`,
      );
    }
  }

  // Circular imports between files (type-only imports are erased and do not count).
  for (const cycle of findCycles(graph)) {
    findings.push(finding("circular-import", cycle[0] ?? "", `Circular import: ${[...cycle, cycle[0] ?? ""].join(" -> ")}`));
  }

  // Declared dependencies that no code uses.
  for (const info of modules) {
    if (info.manifest === undefined) continue;
    for (const dependency of info.manifest.dependsOn) {
      if (!usedDependencies.has(`${info.app}:${info.name}>${dependency}`)) {
        findings.push(
          finding(
            "unused-declared-dependency",
            `${info.dir}/module.json`,
            `"${info.name}" declares a dependency on "${dependency}" that no code uses. Remove it if it is no longer planned.`,
            undefined,
            "warning",
          ),
        );
      }
    }
  }

  return { findings, suppressions: [] };
}

function classify(root: string, file: string, ref: ImportRef, byName: ReadonlyMap<string, PackageInfo>): Target {
  const specifier = ref.specifier;
  if (specifier.startsWith(".")) {
    if (specifier.endsWith(".json")) return { kind: "unresolved" };
    // A style sheet next to the code that imports it (the build tool bundles it). It is not code.
    if (specifier.endsWith(".css") && fileExists(root, posix.normalize(posix.join(posix.dirname(file), specifier))))
      return { kind: "asset" };
    const candidate = posix.normalize(posix.join(posix.dirname(file), specifier));
    if (fileExists(root, candidate) && /\.tsx?$/.test(candidate)) {
      return { kind: "relative", path: candidate };
    }
    const swapped = candidate.replace(/\.js$/, ".ts");
    if (candidate.endsWith(".js") && fileExists(root, swapped)) return { kind: "relative", path: swapped };
    return { kind: "unresolved" };
  }
  const withoutPrefix = specifier.startsWith("node:") ? specifier.slice(5) : specifier;
  if (specifier.startsWith("node:") || builtinModules.includes(specifier)) {
    return { kind: "builtin", base: withoutPrefix.split("/")[0] ?? withoutPrefix };
  }
  const name = packageNameOf(specifier);
  const info = byName.get(name);
  if (info !== undefined) return { kind: "workspace", info, deep: specifier !== name };
  return { kind: "external", name };
}

/** Strongly connected components with more than one file (or a file importing itself). */
function findCycles(graph: ReadonlyMap<string, readonly string[]>): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  let counter = 0;

  const visit = (node: string): void => {
    index.set(node, counter);
    low.set(node, counter);
    counter += 1;
    stack.push(node);
    onStack.add(node);
    for (const next of graph.get(node) ?? []) {
      if (!index.has(next)) {
        visit(next);
        low.set(node, Math.min(low.get(node) ?? 0, low.get(next) ?? 0));
      } else if (onStack.has(next)) {
        low.set(node, Math.min(low.get(node) ?? 0, index.get(next) ?? 0));
      }
    }
    if (low.get(node) === index.get(node)) {
      const component: string[] = [];
      for (;;) {
        const member = stack.pop();
        if (member === undefined) break;
        onStack.delete(member);
        component.push(member);
        if (member === node) break;
      }
      const selfLoop = component.length === 1 && (graph.get(node) ?? []).includes(node);
      if (component.length > 1 || selfLoop) cycles.push(component.sort());
    }
  };

  for (const node of [...graph.keys()].sort()) {
    if (!index.has(node)) visit(node);
  }
  return cycles;
}
