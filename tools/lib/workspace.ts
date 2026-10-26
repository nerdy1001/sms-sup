import { fileExists, listDirectories, readText } from "./files.ts";

export interface PackageInfo {
  /** Root-relative POSIX directory, "." for the repository root. */
  readonly dir: string;
  readonly name: string;
  readonly dependencies: ReadonlySet<string>;
  readonly devDependencies: ReadonlySet<string>;
}

export interface Workspace {
  readonly root: PackageInfo;
  readonly packages: readonly PackageInfo[];
  readonly byName: ReadonlyMap<string, PackageInfo>;
  /** The workspace package that owns a file, or the root package for everything else. */
  ownerOf(file: string): PackageInfo;
}

function readPackage(root: string, dir: string): PackageInfo | undefined {
  const manifest = dir === "." ? "package.json" : `${dir}/package.json`;
  if (!fileExists(root, manifest)) return undefined;
  const parsed: unknown = JSON.parse(readText(root, manifest));
  const record = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  const keys = (field: string): Set<string> => {
    const value = record[field];
    return new Set(typeof value === "object" && value !== null ? Object.keys(value) : []);
  };
  return {
    dir,
    name: typeof record["name"] === "string" ? record["name"] : dir,
    dependencies: keys("dependencies"),
    devDependencies: keys("devDependencies"),
  };
}

export function loadWorkspace(root: string): Workspace {
  const rootPackage = readPackage(root, ".") ?? {
    dir: ".",
    name: "root",
    dependencies: new Set<string>(),
    devDependencies: new Set<string>(),
  };
  const packages: PackageInfo[] = [];
  for (const group of ["apps", "packages"]) {
    for (const name of listDirectories(root, group)) {
      const info = readPackage(root, `${group}/${name}`);
      if (info !== undefined) packages.push(info);
    }
  }
  const byName = new Map(packages.map((info) => [info.name, info]));
  return {
    root: rootPackage,
    packages,
    byName,
    ownerOf(file: string): PackageInfo {
      return packages.find((info) => file.startsWith(`${info.dir}/`)) ?? rootPackage;
    },
  };
}
