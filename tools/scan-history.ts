import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { formatReport, type Report } from "./check.ts";
import { loadAcceptedRisks } from "./lib/accepted-risks.ts";
import { finding, type Finding } from "./lib/model.ts";
import { checkFileName, scanDiff } from "./lib/secrets.ts";

/** The accepted-risk id of a finding in history, for security/accepted-risks.json. */
export function historyId(commit: string, file: string, rule: string): string {
  return `secret:${commit}:${file}:${rule}`;
}

export function findingsFromHistory(diff: string, fileNames: readonly string[], accepted: ReadonlySet<string>): Finding[] {
  const found: Finding[] = [];
  for (const item of scanDiff(diff)) {
    const id = historyId(item.commit, item.file, item.hit.rule);
    if (accepted.has(id)) continue;
    found.push(
      finding(
        `secret-${item.hit.rule}`,
        item.file === "" ? `commit ${item.commit}` : item.file,
        `Commit ${item.commit} added ${item.hit.description} (${item.hit.preview}). Rotate it now: deleting the line does not remove it from history. To accept a false alarm, add the id "${id}" to security/accepted-risks.json.`,
        item.line,
      ),
    );
  }
  for (const name of new Set(fileNames)) {
    const byName = checkFileName(name);
    if (byName !== undefined && byName.severity === "error" && !accepted.has(`secret-file:${name}`)) {
      found.push(
        finding(
          byName.rule,
          name,
          `${byName.message} The file was added at some point in the history. To accept a false alarm, add the id "secret-file:${name}" to security/accepted-risks.json.`,
        ),
      );
    }
  }
  return found;
}

function git(root: string, args: readonly string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 * 1024 });
}

function main(): void {
  const rootIndex = process.argv.indexOf("--root");
  const root = resolve(rootIndex >= 0 ? (process.argv[rootIndex + 1] ?? ".") : ".");
  let diff: string;
  let names: string[];
  try {
    diff = git(root, ["log", "--all", "-p", "-U0", "--no-color", "--no-ext-diff", "--format=commit %H"]);
    names = git(root, ["log", "--all", "--name-only", "--format="])
      .split("\n")
      .filter((line) => line !== "");
  } catch {
    console.log(
      "error   history\n        Git could not read the history. Run this inside a git repository with its full history (in CI: fetch-depth 0). A scan that cannot read the history fails.",
    );
    process.exitCode = 1;
    return;
  }
  const risks = loadAcceptedRisks(root);
  const findings = [...findingsFromHistory(diff, names, new Set(risks.active.keys())), ...risks.findings];
  const report: Report = {
    findings,
    suppressions: [],
    errors: findings.filter((item) => item.severity === "error").length,
    warnings: findings.filter((item) => item.severity === "warning").length,
  };
  console.log(formatReport(report));
  process.exitCode = report.errors > 0 ? 1 : 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
