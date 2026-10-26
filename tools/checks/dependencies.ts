import { fileExists, listDirectories, readText } from "../lib/files.ts";
import { loadAcceptedRisks } from "../lib/accepted-risks.ts";
import { finding, type CheckResult, type Finding } from "../lib/model.ts";

const SECTIONS = ["dependencies", "devDependencies", "optionalDependencies"] as const;
const EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const WORKSPACE_PACKAGE = /^@minesup\//;
const REGISTRY = "https://registry.npmjs.org/";
const MAXIMUM_PER_RULE = 5;

function readJson(root: string, path: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(readText(root, path));
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function manifests(root: string): string[] {
  const paths = ["package.json"];
  for (const group of ["apps", "packages"]) {
    for (const name of listDirectories(root, group)) paths.push(`${group}/${name}/package.json`);
  }
  return paths.filter((path) => fileExists(root, path));
}

export function checkDependencies(root: string, today: Date = new Date()): CheckResult {
  const findings: Finding[] = [];
  checkManifests(root, findings);
  checkNpmrc(root, findings);
  checkLockFile(root, findings);
  findings.push(...loadAcceptedRisks(root, today).findings);
  return { findings, suppressions: [] };
}

function checkManifests(root: string, findings: Finding[]): void {
  for (const path of manifests(root)) {
    const manifest = readJson(root, path);
    if (manifest === undefined) {
      findings.push(finding("dependency-manifest", path, "The file is not valid JSON."));
      continue;
    }
    for (const section of SECTIONS) {
      const entries = manifest[section];
      if (typeof entries !== "object" || entries === null) continue;
      for (const [name, spec] of Object.entries(entries as Record<string, unknown>)) {
        const text = typeof spec === "string" ? spec : "";
        if (/^(git|github:|gitlab:|bitbucket:|https?:|file:|link:|npm:)/.test(text) || /^[\w.-]+\/[\w.-]+(#.*)?$/.test(text)) {
          findings.push(finding("dependency-source", path, `${name} comes from "${text}". Dependencies come from the npm registry only, so that the lock file can vouch for them.`));
        } else if (text === "*" && WORKSPACE_PACKAGE.test(name)) {
          continue;
        } else if (!EXACT.test(text)) {
          findings.push(finding("dependency-not-exact", path, `${name} is "${text}". Pin an exact version (1.2.3); ranges let a new release enter without a pull request.`));
        }
      }
    }
  }
}

function checkNpmrc(root: string, findings: Finding[]): void {
  if (!fileExists(root, ".npmrc")) {
    findings.push(finding("npmrc-policy", ".npmrc", "The file is missing. It must set ignore-scripts=true and save-exact=true."));
    return;
  }
  const text = readText(root, ".npmrc");
  for (const setting of ["ignore-scripts=true", "save-exact=true"]) {
    if (!text.split("\n").some((line) => line.trim() === setting)) {
      findings.push(finding("npmrc-policy", ".npmrc", `The setting ${setting} is missing.`));
    }
  }
}

function checkLockFile(root: string, findings: Finding[]): void {
  if (!fileExists(root, "package-lock.json")) {
    findings.push(finding("lockfile-missing", "package-lock.json", "No lock file. Run npm install once and commit it: the install in CI and the audit depend on it.", undefined, "warning"));
    return;
  }
  const lock = readJson(root, "package-lock.json");
  const packages = lock?.packages;
  if (typeof packages !== "object" || packages === null) {
    findings.push(finding("lockfile-format", "package-lock.json", 'Expected a lock file of version 2 or 3 with a "packages" section.'));
    return;
  }
  let foreign = 0;
  let unchecked = 0;
  for (const [path, entry] of Object.entries(packages as Record<string, unknown>)) {
    if (path === "" || typeof entry !== "object" || entry === null) continue;
    const record = entry as { resolved?: unknown; integrity?: unknown; link?: unknown };
    if (record.link === true || typeof record.resolved !== "string") continue;
    if (!record.resolved.startsWith(REGISTRY)) {
      foreign += 1;
      if (foreign <= MAXIMUM_PER_RULE) findings.push(finding("lockfile-source", "package-lock.json", `${path} is fetched from ${record.resolved}, not from the npm registry.`));
    }
    if (typeof record.integrity !== "string" || record.integrity === "") {
      unchecked += 1;
      if (unchecked <= MAXIMUM_PER_RULE) findings.push(finding("lockfile-integrity", "package-lock.json", `${path} has no integrity hash, so a changed download would not be detected.`));
    }
  }
}
