import { fileExists, listDirectories, readText } from "../lib/files.ts";
import { finding, type CheckResult, type Finding } from "../lib/model.ts";

/**
 * The dependency register (docs/dependencies.md). Every library the code depends on directly has a
 * row that says what it is for, why it was not written by hand, what happens if it is abandoned, and
 * who may use it. The point is to make adding a dependency a decision that is written down in the same
 * pull request, so that the number of libraries stays something one person can keep in mind.
 */

export const REGISTER_PATH = "docs/dependencies.md";
const SECTIONS = ["dependencies", "devDependencies", "optionalDependencies"] as const;
const COLUMNS = [
  "Package",
  "Used by",
  "What it is for",
  "Why not written by hand",
  "If it is abandoned",
  "Where it may be imported",
] as const;
const MINIMUM_TEXT = 12;

interface Declared {
  readonly name: string;
  readonly workspaces: Set<string>;
}

interface Row {
  readonly name: string;
  readonly cells: string[];
  readonly line: number;
}

function workspaceName(path: string): string {
  if (path === "package.json") return "root";
  return path.split("/")[1] ?? path;
}

function declaredDependencies(root: string): Map<string, Declared> {
  const paths = ["package.json"];
  for (const group of ["apps", "packages"]) {
    for (const name of listDirectories(root, group)) paths.push(`${group}/${name}/package.json`);
  }
  const found = new Map<string, Declared>();
  for (const path of paths.filter((candidate) => fileExists(root, candidate))) {
    let manifest: Record<string, unknown>;
    try {
      manifest = JSON.parse(readText(root, path)) as Record<string, unknown>;
    } catch {
      continue;
    }
    for (const section of SECTIONS) {
      const entries = manifest[section];
      if (typeof entries !== "object" || entries === null) continue;
      for (const name of Object.keys(entries)) {
        if (name.startsWith("@minesup/")) continue;
        const entry = found.get(name) ?? { name, workspaces: new Set<string>() };
        entry.workspaces.add(workspaceName(path));
        found.set(name, entry);
      }
    }
  }
  return found;
}

function parseRows(text: string): Row[] {
  const rows: Row[] = [];
  text.split("\n").forEach((line, index) => {
    if (!line.trim().startsWith("|")) return;
    const cells = line
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((cell) => cell.trim());
    if (cells.length < COLUMNS.length) return;
    const first = cells[0] ?? "";
    if (first === COLUMNS[0] || /^:?-+:?$/.test(first)) return;
    const name = first.replace(/`/g, "");
    rows.push({ name, cells, line: index + 1 });
  });
  return rows;
}

export function checkRegister(root: string): CheckResult {
  const findings: Finding[] = [];
  const declared = declaredDependencies(root);
  if (declared.size === 0 && !fileExists(root, REGISTER_PATH)) return { findings, suppressions: [] };

  if (!fileExists(root, REGISTER_PATH)) {
    findings.push(
      finding(
        "register-missing",
        REGISTER_PATH,
        `Dependencies are declared (${[...declared.keys()].join(", ")}) but the register does not exist. Create ${REGISTER_PATH} with the columns: ${COLUMNS.join(" | ")}.`,
      ),
    );
    return { findings, suppressions: [] };
  }

  const rows = parseRows(readText(root, REGISTER_PATH));
  const byName = new Map(rows.map((row) => [row.name, row]));

  for (const entry of declared.values()) {
    const row = byName.get(entry.name);
    if (row === undefined) {
      findings.push(
        finding(
          "register-unregistered",
          REGISTER_PATH,
          `${entry.name} is a dependency (in ${[...entry.workspaces].join(", ")}) but has no row. Add one: what it is for, why not by hand, what if abandoned, who may import it.`,
        ),
      );
      continue;
    }
    COLUMNS.forEach((column, index) => {
      if (index < 2) return;
      const cell = row.cells[index] ?? "";
      if (cell.length < MINIMUM_TEXT) {
        findings.push(
          finding(
            "register-incomplete",
            REGISTER_PATH,
            `The row of ${entry.name} has too little text under "${column}". Say it in a full sentence.`,
            row.line,
          ),
        );
      }
    });
    const listed = new Set(
      (row.cells[1] ?? "")
        .split(",")
        .map((part) => part.replace(/`/g, "").trim())
        .filter((part) => part !== ""),
    );
    const missing = [...entry.workspaces].filter((workspace) => !listed.has(workspace));
    if (missing.length > 0) {
      findings.push(
        finding(
          "register-usage",
          REGISTER_PATH,
          `${entry.name} is declared in ${missing.join(", ")}, which the "Used by" column does not list.`,
          row.line,
        ),
      );
    }
  }

  for (const row of rows) {
    if (!declared.has(row.name)) {
      findings.push(
        finding(
          "register-stale",
          REGISTER_PATH,
          `${row.name} has a row but no package.json declares it. Remove the row, or add the dependency.`,
          row.line,
          "warning",
        ),
      );
    }
  }
  return { findings, suppressions: [] };
}
