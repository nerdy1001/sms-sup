import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configFromEnvironment, createConnection, type Connection } from "./connection.ts";

/**
 * A throw-away PostgreSQL for the tests that need a real one (the migration runner and the
 * row-level security policies). It looks for a server in this order and uses the first it finds:
 *
 *   1. the server named by PGHOST, or the local database container (127.0.0.1:5432, npm run db:up)
 *      when SMS_TEST_DB_MODE=docker
 *   2. PostgreSQL programs installed on this computer: it starts its own server in a temporary
 *      folder and removes it afterwards (GitHub's Ubuntu runners have them)
 *   3. the local database container, when something answers on 127.0.0.1:5432
 *
 * When none exists the tests are skipped, and say so. Each test file works in a database of its own
 * that is dropped at the end, so the data of the local database is never touched.
 */

export interface TestDatabase {
  /** Connected to the scratch database. */
  readonly connection: Connection;
  /** Where the server came from, for the test report. */
  readonly source: string;
  /** How a database driver reaches the server (a folder name means a Unix socket). The database is `database`. */
  readonly endpoint: { readonly host: string; readonly port: number; readonly database: string };
  close(): Promise<void>;
}

function findBinaryDirectory(): string | undefined {
  // Starting a temporary server needs a POSIX shell. On Windows use PGHOST or the Docker database instead.
  if (process.platform === "win32") return undefined;
  for (const base of ["/usr/lib/postgresql"]) {
    if (!existsSync(base)) continue;
    const versions = readdirSync(base).sort((a, b) => Number(b) - Number(a));
    for (const version of versions) {
      const directory = join(base, version, "bin");
      if (existsSync(join(directory, "initdb"))) return directory;
    }
  }
  const which = spawnSync("sh", ["-c", "command -v initdb"], { encoding: "utf8" });
  const path = which.error === undefined && typeof which.stdout === "string" ? which.stdout.trim() : "";
  return path === "" ? undefined : path.slice(0, path.lastIndexOf("/"));
}

function shell(command: string, asPostgres: boolean): void {
  const result = asPostgres
    ? spawnSync("su", ["postgres", "-c", command], { encoding: "utf8" })
    : spawnSync("sh", ["-c", command], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${command}\n${result.stderr}`);
}

function isRoot(): boolean {
  return typeof process.getuid === "function" && process.getuid() === 0;
}

async function openUnchecked(): Promise<TestDatabase | undefined> {
  const scratch = `sms_test_${randomBytes(5).toString("hex")}`;
  let admin: Connection | undefined;
  let stopCluster: (() => void) | undefined;
  let source = "";
  let endpoint = { host: "127.0.0.1", port: 5432 };

  if (process.env["PGHOST"] !== undefined && process.env["SMS_TEST_DB_MODE"] !== "docker") {
    const config = configFromEnvironment(process.env);
    admin = createConnection({ ...config, database: "postgres" });
    source = "the server named by PGHOST";
    endpoint = { host: config.host, port: config.port };
  } else if (process.env["SMS_TEST_DB_MODE"] === "docker") {
    admin = createConnection({ host: "127.0.0.1", port: 5432, user: "sms", database: "postgres" });
    source = "the local Docker database";
  } else {
    const binaries = findBinaryDirectory();
    if (binaries !== undefined) {
      const folder = mkdtempSync(join(tmpdir(), "sms-pg-"));
      const asPostgres = isRoot();
      if (asPostgres) shell(`chown postgres '${folder}'`, false);
      const port = 40000 + Math.floor(Math.random() * 20000);
      shell(`'${binaries}/initdb' -D '${folder}/data' -A trust -U sms >/dev/null`, asPostgres);
      shell(
        `'${binaries}/pg_ctl' -D '${folder}/data' -o "-p ${port} -k '${folder}' -c listen_addresses=" -l '${folder}/log' -w start >/dev/null`,
        asPostgres,
      );
      stopCluster = () => {
        try {
          shell(`'${binaries}/pg_ctl' -D '${folder}/data' -m immediate stop >/dev/null`, asPostgres);
        } finally {
          rmSync(folder, { recursive: true, force: true });
        }
      };
      admin = createConnection({ host: folder, port, user: "sms", database: "postgres" });
      source = `a temporary server (${binaries})`;
      endpoint = { host: folder, port };
    } else {
      const local = createConnection({ host: "127.0.0.1", port: 5432, user: "sms", database: "postgres" });
      const answers = await local.run("select 1;").then(
        () => true,
        () => false,
      );
      if (answers) {
        admin = local;
        source = "the local Docker database";
      }
    }
  }
  if (admin === undefined) {
    if (process.env["SMS_REQUIRE_DB"] === "yes") throw new Error(`SMS_REQUIRE_DB=yes but ${SKIP_MESSAGE}`);
    return undefined;
  }

  const root = admin;
  try {
    await root.run(`create database ${scratch};`);
  } catch (error) {
    stopCluster?.();
    throw error;
  }
  const connection = createConnection({ ...root.config, database: scratch });
  return {
    connection,
    source,
    endpoint: { ...endpoint, database: scratch },
    async close() {
      try {
        await root.run(`drop database if exists ${scratch} with (force);`);
      } finally {
        stopCluster?.();
      }
    },
  };
}

/**
 * Opens the throw-away database, or returns undefined when none can be had. A problem while looking for
 * or starting one never stops the other tests of the file: it is reported and the database tests are
 * skipped. With SMS_REQUIRE_DB=yes (GitHub) it is an error instead, so that a skip cannot go unnoticed.
 */
export async function openTestDatabase(): Promise<TestDatabase | undefined> {
  try {
    return await openUnchecked();
  } catch (error) {
    if (process.env["SMS_REQUIRE_DB"] === "yes") throw error;
    process.stderr.write(
      `# database tests skipped: could not open a database (${error instanceof Error ? error.message.split("\n")[0] : String(error)})\n`,
    );
    return undefined;
  }
}

/** Why the database tests were skipped, for the test report. With SMS_REQUIRE_DB=yes (set in CI) a skip becomes a failure. */
export const SKIP_MESSAGE =
  "no PostgreSQL available: install PostgreSQL, or start the local database with `npm run db:up` and set SMS_TEST_DB_MODE=docker";
