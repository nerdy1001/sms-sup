import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { checkDependencies } from "./checks/dependencies.ts";
import { checkDocs } from "./checks/docs.ts";
import { checkImports } from "./checks/imports.ts";
import { checkInfra } from "./checks/infra.ts";
import { checkMigrations } from "./checks/migrations.ts";
import { checkRegister } from "./checks/register.ts";
import { checkSecrets } from "./checks/secrets.ts";
import { checkSecurity } from "./checks/security.ts";
import { checkSql } from "./checks/sql.ts";
import { checkStandards } from "./checks/standards.ts";
import { checkStructure } from "./checks/structure.ts";
import { checkWeb } from "./checks/web.ts";
import type { CheckResult, Finding, Suppression } from "./lib/model.ts";

export const CHECKS: Readonly<Record<string, (root: string) => CheckResult>> = {
  imports: checkImports,
  structure: checkStructure,
  sql: checkSql,
  standards: checkStandards,
  docs: checkDocs,
  security: checkSecurity,
  secrets: checkSecrets,
  dependencies: (root) => checkDependencies(root),
  infra: checkInfra,
  migrations: checkMigrations,
  register: checkRegister,
  web: checkWeb,
};

export interface Report {
  readonly findings: Finding[];
  readonly suppressions: Suppression[];
  readonly errors: number;
  readonly warnings: number;
}

export function runChecks(root: string, only?: readonly string[]): Report {
  const findings: Finding[] = [];
  const suppressions: Suppression[] = [];
  for (const [name, run] of Object.entries(CHECKS)) {
    if (only !== undefined && !only.includes(name)) continue;
    const result = run(root);
    findings.push(...result.findings);
    suppressions.push(...result.suppressions);
  }
  findings.sort((a, b) => a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0) || a.rule.localeCompare(b.rule));
  return {
    findings,
    suppressions,
    errors: findings.filter((item) => item.severity === "error").length,
    warnings: findings.filter((item) => item.severity === "warning").length,
  };
}

export function formatReport(report: Report): string {
  const lines: string[] = [];
  for (const item of report.findings) {
    const place = item.line === undefined ? item.file : `${item.file}:${item.line}`;
    lines.push(`${item.severity.padEnd(7)} ${item.rule.padEnd(28)} ${place}`);
    lines.push(`        ${item.message}`);
  }
  if (report.suppressions.length > 0) {
    lines.push("", "Suppressions in use (each needs a reason, review them in pull requests):");
    for (const item of report.suppressions) {
      lines.push(`  ${item.rule} at ${item.file}:${item.line}: ${item.reason}`);
    }
  }
  lines.push("", `${report.errors} error(s), ${report.warnings} warning(s), ${report.suppressions.length} suppression(s).`);
  return lines.join("\n");
}

function main(): void {
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf("--root");
  const onlyIndex = args.indexOf("--only");
  const root = resolve(rootIndex >= 0 ? (args[rootIndex + 1] ?? ".") : ".");
  const only = onlyIndex >= 0 ? (args[onlyIndex + 1] ?? "").split(",") : undefined;
  const report = runChecks(root, only);
  console.log(formatReport(report));
  process.exitCode = report.errors > 0 ? 1 : 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
