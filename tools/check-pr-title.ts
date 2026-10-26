import { pathToFileURL } from "node:url";
import { plannedModules, rules } from "./rules.config.ts";

export const COMMIT_TYPES = ["feat", "fix", "docs", "refactor", "test", "chore", "build", "ci", "perf", "security", "revert"] as const;

const SCOPES = [...new Set([...plannedModules.map((entry) => entry.code.toLowerCase()), ...rules.extraCommitScopes])].sort();

const PATTERN = new RegExp(`^(${COMMIT_TYPES.join("|")})(?:\\(((?:${SCOPES.join("|")})(?:,(?:${SCOPES.join("|")}))*)\\))?(!)?: (.+)$`);

/** Returns a message explaining what is wrong, or undefined when the title is acceptable. */
export function checkPrTitle(title: string): string | undefined {
  const help = `Expected "type(scope): subject", for example "feat(rg): add scholar identifier". Types: ${COMMIT_TYPES.join(", ")}. Scopes: ${SCOPES.join(", ")} (module codes in lowercase).`;
  const match = PATTERN.exec(title.trim());
  if (match === null) return `The pull request title does not follow the convention. ${help}`;
  const subject = match[4] ?? "";
  if (subject.length < 5) return `The subject is too short to say what changed. ${help}`;
  if (title.length > 100) return `The title is ${title.length} characters; keep it within 100.`;
  if (subject.endsWith(".")) return "The subject must not end with a full stop.";
  return undefined;
}

function main(): void {
  const title = process.env["PR_TITLE"];
  if (title === undefined) {
    console.error("Set PR_TITLE to the pull request title.");
    process.exitCode = 2;
    return;
  }
  const problem = checkPrTitle(title);
  if (problem !== undefined) {
    console.error(problem);
    process.exitCode = 1;
    return;
  }
  console.log("Pull request title is valid.");
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
