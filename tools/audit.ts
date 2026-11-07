import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadAcceptedRisks } from "./lib/accepted-risks.ts";

export const LEVELS = ["info", "low", "moderate", "high", "critical"] as const;
export type Level = (typeof LEVELS)[number];

export interface Advisory {
  readonly id: string;
  readonly package: string;
  readonly severity: Level;
  readonly title: string;
  readonly url: string;
}

export interface ParsedAudit {
  /** Set when npm could not audit (for example, the registry was unreachable). The audit then fails. */
  readonly error: string | undefined;
  readonly advisories: Advisory[];
}

export interface Evaluation {
  readonly blocking: Advisory[];
  readonly warnings: Advisory[];
  readonly accepted: Advisory[];
}

const asLevel = (value: unknown): Level => ((LEVELS as readonly unknown[]).includes(value) ? (value as Level) : "moderate");

/** Reads the JSON of `npm audit --json` into a flat list of advisories. */
export function parseAudit(text: string): ParsedAudit {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: "npm audit did not return JSON.", advisories: [] };
  }
  const root = (typeof data === "object" && data !== null ? data : {}) as {
    error?: { summary?: string; detail?: string; code?: string };
    vulnerabilities?: Record<string, { name?: string; via?: unknown[] }>;
  };
  if (root.error !== undefined) {
    return {
      error: `npm audit failed: ${root.error.summary ?? root.error.code ?? "unknown error"}${root.error.detail === undefined ? "" : ` (${root.error.detail})`}`,
      advisories: [],
    };
  }
  if (root.vulnerabilities === undefined) return { error: "npm audit returned no vulnerability section.", advisories: [] };

  const seen = new Map<string, Advisory>();
  for (const [name, vulnerability] of Object.entries(root.vulnerabilities)) {
    for (const via of vulnerability.via ?? []) {
      if (typeof via !== "object" || via === null) continue;
      const entry = via as { source?: unknown; name?: unknown; title?: unknown; url?: unknown; severity?: unknown };
      const url = typeof entry.url === "string" ? entry.url : "";
      const id =
        /GHSA-[a-z0-9-]+/i.exec(url)?.[0]?.toUpperCase() ??
        (typeof entry.source === "string" || typeof entry.source === "number" ? String(entry.source) : `${name}-unknown`);
      const advisory: Advisory = {
        id,
        package: typeof entry.name === "string" ? entry.name : (vulnerability.name ?? name),
        severity: asLevel(entry.severity),
        title: typeof entry.title === "string" ? entry.title : "",
        url,
      };
      seen.set(`${id}|${advisory.package}`, advisory);
    }
  }
  return { error: undefined, advisories: [...seen.values()] };
}

/**
 * The policy: a high or critical advisory in a production dependency blocks the merge. Everything
 * else (lower severity, or a development tool) is reported as a warning. An advisory that is
 * listed in security/accepted-risks.json, and has not expired, is accepted.
 */
export function evaluate(production: readonly Advisory[], everything: readonly Advisory[], accepted: ReadonlySet<string>): Evaluation {
  const productionKeys = new Set(production.map((item) => `${item.id}|${item.package}`));
  const blocking: Advisory[] = [];
  const warnings: Advisory[] = [];
  const acceptedList: Advisory[] = [];
  for (const item of everything) {
    if (accepted.has(item.id)) {
      acceptedList.push(item);
      continue;
    }
    const isProduction = productionKeys.has(`${item.id}|${item.package}`);
    const serious = LEVELS.indexOf(item.severity) >= LEVELS.indexOf("high");
    (isProduction && serious ? blocking : warnings).push(item);
  }
  return { blocking, warnings, accepted: acceptedList };
}

export function describe(item: Advisory): string {
  return `${item.severity.toUpperCase().padEnd(8)} ${item.package}: ${item.title} (${item.id}) ${item.url}`;
}

function runAudit(root: string, extra: readonly string[]): ParsedAudit {
  const result = spawnSync("npm", ["audit", "--json", ...extra], { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  return parseAudit(result.stdout);
}

function main(): void {
  const root = resolve(".");
  const risks = loadAcceptedRisks(root);
  for (const problem of risks.findings) console.log(`error   ${problem.rule} ${problem.file}\n        ${problem.message}`);

  const production = runAudit(root, ["--omit=dev"]);
  const everything = runAudit(root, []);
  const failure = production.error ?? everything.error;
  if (failure !== undefined) {
    console.log(`error   audit\n        ${failure} The audit cannot vouch for the dependencies, so it fails.`);
    process.exitCode = 1;
    return;
  }
  const result = evaluate(production.advisories, everything.advisories, new Set(risks.active.keys()));
  for (const item of result.blocking) console.log(`error   ${describe(item)}`);
  for (const item of result.warnings) console.log(`warning ${describe(item)}`);
  for (const item of result.accepted) console.log(`accepted ${describe(item)}`);
  console.log(`\n${result.blocking.length} blocking, ${result.warnings.length} warning(s), ${result.accepted.length} accepted.`);
  process.exitCode = result.blocking.length > 0 || risks.findings.length > 0 ? 1 : 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
