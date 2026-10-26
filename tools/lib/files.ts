import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";

const SKIPPED_DIRECTORIES = new Set(["node_modules", ".git", "dist", "coverage"]);

export function toPosix(path: string): string {
  return path.split(sep).join("/");
}

/** Lists every file below `start` (relative to `root`) as sorted, root-relative POSIX paths. */
export function listFiles(root: string, start = "."): string[] {
  const found: string[] = [];
  const walk = (relativeDir: string): void => {
    const absolute = join(root, relativeDir);
    if (!existsSync(absolute)) return;
    for (const name of readdirSync(absolute)) {
      if (SKIPPED_DIRECTORIES.has(name)) continue;
      const relative = relativeDir === "." ? name : `${relativeDir}/${name}`;
      if (statSync(join(root, relative)).isDirectory()) {
        walk(relative);
      } else {
        found.push(relative);
      }
    }
  };
  walk(toPosix(start));
  return found.sort();
}

export function listDirectories(root: string, relativeDir: string): string[] {
  const absolute = join(root, relativeDir);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute)
    .filter((name) => statSync(join(absolute, name)).isDirectory())
    .sort();
}

export function listEntries(root: string, relativeDir: string): string[] {
  const absolute = join(root, relativeDir);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute).sort();
}

export function readText(root: string, relativePath: string): string {
  return readFileSync(join(root, relativePath), "utf8");
}

export function fileExists(root: string, relativePath: string): boolean {
  return existsSync(join(root, relativePath));
}
