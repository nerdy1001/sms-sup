import { literal, type Connection } from "./connection.ts";
import { loadSqlFiles, type LoadedSql } from "./sql-files.ts";

/** Anything that changes a database lives here: applying migrations, seeds, and starting over. */

const LOCK_KEY = 727274;

const BOOTSTRAP = `
create schema if not exists platform;
create table if not exists platform.schema_migrations (
    scope text not null,
    name text not null,
    checksum text not null,
    applied_at timestamptz not null default now(),
    primary key (scope, name)
);
alter table platform.schema_migrations enable row level security;
`;

export interface Applied {
  readonly scope: string;
  readonly name: string;
  readonly checksum: string;
}

export interface Plan {
  readonly pending: LoadedSql[];
  /** Applied before, but the file has been edited since. Never allowed. */
  readonly changed: LoadedSql[];
  /** Recorded as applied, but no file exists any more. */
  readonly missing: Applied[];
}

export function plan(found: readonly LoadedSql[], applied: readonly Applied[]): Plan {
  const key = (scope: string, name: string): string => `${scope}/${name}`;
  const appliedByKey = new Map(applied.map((item) => [key(item.scope, item.name), item]));
  const foundKeys = new Set(found.map((item) => key(item.scope, item.name)));
  const pending: LoadedSql[] = [];
  const changed: LoadedSql[] = [];
  for (const item of found) {
    const before = appliedByKey.get(key(item.scope, item.name));
    if (before === undefined) pending.push(item);
    else if (before.checksum !== item.checksum) changed.push(item);
  }
  const missing = applied.filter((item) => !foundKeys.has(key(item.scope, item.name)));
  return { pending, changed, missing };
}

export function readApplied(connection: Connection): Applied[] {
  connection.run(BOOTSTRAP);
  const output = connection.run("select scope, name, checksum from platform.schema_migrations order by scope, name;");
  return output
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const [scope = "", name = "", sum = ""] = line.split("|");
      return { scope, name, checksum: sum };
    });
}

export interface MigrateResult {
  readonly applied: string[];
  readonly alreadyApplied: number;
}

/** Applies every pending migration, each in its own transaction. Stops at the first problem. */
export function migrate(connection: Connection, root: string, app: string, report: (line: string) => void = () => {}): MigrateResult {
  const found = loadSqlFiles(root, "migration", app);
  const state = plan(found, readApplied(connection));
  if (state.changed.length > 0) {
    const names = state.changed.map((item) => `${item.scope}/${item.name}`).join(", ");
    throw new Error(`An applied migration was edited: ${names}. Never change a migration that has been applied; add a new one. (On your own computer, "npm run db:reset" starts again from nothing.)`);
  }
  if (state.missing.length > 0) {
    const names = state.missing.map((item) => `${item.scope}/${item.name}`).join(", ");
    throw new Error(`The database has migrations that no file explains: ${names}. Is this the right database, or the right branch?`);
  }
  const applied: string[] = [];
  for (const item of state.pending) {
    report(`applying ${item.scope}/${item.name}`);
    connection.run(
      [
        "begin;",
        `select pg_advisory_xact_lock(${LOCK_KEY});`,
        item.sql,
        `insert into platform.schema_migrations (scope, name, checksum) values (${literal(item.scope)}, ${literal(item.name)}, ${literal(item.checksum)});`,
        "commit;",
      ].join("\n"),
    );
    applied.push(`${item.scope}/${item.name}`);
  }
  return { applied, alreadyApplied: found.length - state.pending.length };
}

/** Applies every seed file in order, each in its own transaction. Seeds are written to be repeatable. */
export function seed(connection: Connection, root: string, app: string, report: (line: string) => void = () => {}): string[] {
  const done: string[] = [];
  for (const item of loadSqlFiles(root, "seed", app)) {
    report(`seeding ${item.scope}/${item.name}`);
    connection.run(`begin;\n${item.sql}\ncommit;`);
    done.push(`${item.scope}/${item.name}`);
  }
  return done;
}

/** The environments in which synthetic data and a reset are allowed. Production sets SMS_ENV=production. */
const SYNTHETIC_ENVIRONMENTS = ["local", "staging", "test"];

export function assertSyntheticEnvironment(env: Readonly<Record<string, string | undefined>>, action: string): void {
  const name = env["SMS_ENV"] ?? "local";
  if (!SYNTHETIC_ENVIRONMENTS.includes(name)) {
    throw new Error(`Refusing to ${action}: SMS_ENV is "${name}". Seeding and resetting are allowed only in ${SYNTHETIC_ENVIRONMENTS.join(", ")}.`);
  }
}

function assertSafeName(name: string): void {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) throw new Error(`"${name}" is not a safe database name.`);
}

/** Drops the database and creates it again, empty. Local use only. */
export function recreateDatabase(connection: Connection): void {
  const name = connection.config.database;
  assertSafeName(name);
  connection.run(`drop database if exists ${name} with (force);\ncreate database ${name};`, { database: "postgres" });
}

export function status(connection: Connection, root: string, app: string): { applied: Applied[]; plan: Plan } {
  const found = loadSqlFiles(root, "migration", app);
  const applied = readApplied(connection);
  return { applied, plan: plan(found, applied) };
}
