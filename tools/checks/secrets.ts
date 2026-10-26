import { readText, listFiles } from "../lib/files.ts";
import { finding, type CheckResult, type Finding, type Suppression } from "../lib/model.ts";
import { checkFileName, scanText } from "../lib/secrets.ts";

const MAXIMUM_BYTES = 1_000_000;

export function checkSecrets(root: string): CheckResult {
  const findings: Finding[] = [];
  const suppressions: Suppression[] = [];
  for (const file of listFiles(root)) {
    const byName = checkFileName(file);
    if (byName !== undefined) findings.push(finding(byName.rule, file, byName.message, undefined, byName.severity));
    if (file.endsWith("package-lock.json")) continue;
    const text = readText(root, file);
    if (text.length > MAXIMUM_BYTES || text.includes("\0")) continue;
    const scan = scanText(text);
    for (const { line, hit } of scan.hits) {
      findings.push(finding(`secret-${hit.rule}`, file, `Looks like ${hit.description} (${hit.preview}). Remove it, rotate it if it was ever real, and read it from the environment. A documented example can carry "secrets-allow: ${hit.rule} -- <reason>".`, line));
    }
    for (const item of scan.allowed) suppressions.push({ rule: `secret-${item.rule}`, file, line: item.line, reason: item.reason });
  }
  return { findings, suppressions };
}
