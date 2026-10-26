import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export interface PolicyInput {
  /** The text of the commit messages of the pull request. Dependabot writes its metadata there. */
  readonly messages: string;
  readonly files: readonly string[];
}

export interface PolicyResult {
  readonly merge: boolean;
  readonly reason: string;
}

const ALLOWED_FILES = [/^package\.json$/, /^package-lock\.json$/, /^(apps|packages)\/[^/]+\/package\.json$/, /^\.github\/workflows\/[^/]+\.ya?ml$/];

/**
 * Decides whether a Dependabot pull request may merge by itself once every check has passed.
 * Patch and minor updates may. Major updates, updates of 0.x packages (where a minor release can
 * break things), unreadable metadata and any change outside the dependency files go to a human.
 */
export function evaluateDependabotPr(input: PolicyInput): PolicyResult {
  const types = [...input.messages.matchAll(/update-type:\s*version-update:semver-(patch|minor|major)/g)].map((match) => match[1] ?? "");
  if (types.length === 0) return { merge: false, reason: "The update type could not be read from the commit message." };
  if (types.includes("major")) return { merge: false, reason: "A major update needs a human review." };

  const versions = [...input.messages.matchAll(/dependency-version:\s*(\S+)/g)].map((match) => match[1] ?? "");
  const zeroMinor = types.some((type, index) => type === "minor" && (versions[index] ?? "").startsWith("0."));
  if (zeroMinor) return { merge: false, reason: "A minor update of a 0.x package can break things and needs a human review." };

  const outside = input.files.filter((file) => !ALLOWED_FILES.some((pattern) => pattern.test(file)));
  if (input.files.length === 0) return { merge: false, reason: "The list of changed files is empty." };
  if (outside.length > 0) return { merge: false, reason: `The pull request changes files other than dependency files: ${outside.join(", ")}.` };
  return { merge: true, reason: `All ${types.length} update(s) are patch or minor and touch only dependency files.` };
}

function main(): void {
  const [messagesFile, filesFile] = process.argv.slice(2);
  if (messagesFile === undefined || filesFile === undefined) {
    console.log("Usage: node tools/dependabot-policy.ts <messages-file> <changed-files-file>");
    process.exitCode = 2;
    return;
  }
  const files = readFileSync(filesFile, "utf8").split("\n").map((line) => line.trim()).filter((line) => line !== "");
  const result = evaluateDependabotPr({ messages: readFileSync(messagesFile, "utf8"), files });
  console.log(result.merge ? `Merge: ${result.reason}` : `Not merging: ${result.reason}`);
  process.exitCode = result.merge ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
