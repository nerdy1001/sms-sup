import { createHash } from "node:crypto";
import { listFiles, readText } from "../lib/files.ts";

/**
 * Where the SQL files of the database live. The kernel owns the schema "platform"; each module owns
 * the schema called after it. Migrations change the structure and are applied exactly once. Seeds
 * add synthetic data and can be applied again without harm.
 */

export type SqlKind = "migration" | "seed";

export interface SqlFile {
  readonly app: string;
  /** "platform" for the kernel, otherwise the module name. */
  readonly scope: string;
  readonly kind: SqlKind;
  readonly file: string;
  /** The file name without the folder, for example 0001_platform_schema.sql. */
  readonly name: string;
}

const KERNEL = /^apps\/([^/]+)\/src\/kernel\/db\/(migrations|seeds)\/([^/]+\.sql)$/;
const MODULE = /^apps\/([^/]+)\/src\/modules\/([^/]+)\/internal\/infrastructure\/(migrations|seeds)\/([^/]+\.sql)$/;

export const FILE_NAME = /^\d{4}_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/;

export function describeSqlFile(file: string): SqlFile | undefined {
  const kernel = KERNEL.exec(file);
  if (kernel !== null) {
    return { app: kernel[1] ?? "", scope: "platform", kind: kernel[2] === "seeds" ? "seed" : "migration", file, name: kernel[3] ?? "" };
  }
  const module = MODULE.exec(file);
  if (module !== null) {
    return {
      app: module[1] ?? "",
      scope: module[2] ?? "",
      kind: module[3] === "seeds" ? "seed" : "migration",
      file,
      name: module[4] ?? "",
    };
  }
  return undefined;
}

/** Every SQL file of the repository (or of one application), in the order they are applied: platform first, then modules by name, then by number. */
export function findSqlFiles(root: string, kind?: SqlKind, app?: string): SqlFile[] {
  const found: SqlFile[] = [];
  for (const file of listFiles(root, "apps")) {
    const described = describeSqlFile(file);
    if (described === undefined) continue;
    if (kind !== undefined && described.kind !== kind) continue;
    if (app !== undefined && described.app !== app) continue;
    found.push(described);
  }
  const rank = (scope: string): string => (scope === "platform" ? "0" : `1${scope}`);
  return found.sort((a, b) => a.app.localeCompare(b.app) || rank(a.scope).localeCompare(rank(b.scope)) || a.name.localeCompare(b.name));
}

export function checksum(text: string): string {
  return createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");
}

export interface LoadedSql extends SqlFile {
  readonly sql: string;
  readonly checksum: string;
}

export function loadSqlFiles(root: string, kind: SqlKind, app: string): LoadedSql[] {
  return findSqlFiles(root, kind, app).map((described) => {
    if (!FILE_NAME.test(described.name)) {
      throw new Error(
        `${described.file}: the name must look like 0001_short_description.sql (four digits, lowercase words joined by underscores).`,
      );
    }
    const sql = readText(root, described.file);
    return { ...described, sql, checksum: checksum(sql) };
  });
}
