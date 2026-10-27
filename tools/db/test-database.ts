import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnection, type Connection } from "./connection.ts";

/**
 * A throw-away PostgreSQL for the tests that need a real one (the migration runner and the
 * row-level security policies). It looks for a server in this order and uses the first it finds:
 *
 *   1. the server named by PGHOST (host mode), or by SMS_TEST_DB_MODE=docker
 *   2. PostgreSQL programs installed on this computer: it starts its own server in a temporary
 *      folder and removes it afterwards (GitHub's Ubuntu runners have them)
 *   3. the local database container, when it is running (npm run db:up)
 *
 * When none exists the tests are skipped, and say so. Each test file works in a database of its own
 * that is dropped at the end, so the data of the local database is never touched.
 */

export interface TestDatabase {
  /** Connected to the scratch database. */
  readonly connection: Connection;
  /** Where the server came from, for the test report. */
  readonly source: string;
  close(): void;
}

function findBinaryDirectory(): string | undefined {
  for (const base of ["/usr/lib/postgresql"]) {
    if (!existsSync(base)) continue;
    const versions = readdirSync(base).sort((a, b) => Number(b) - Number(a));
    for (const version of versions) {
      const directory = join(base, version, "bin");
      if (existsSync(join(directory, "initdb"))) return directory;
    }
  }
  const which = spawnSync("sh", ["-c", "command -v initdb"], { encoding: "utf8" });
  const path = which.stdout.trim();
  return path === "" ? undefined : path.slice(0, path.lastIndexOf("/"));
}

function shell(command: string, asPostgres: boolean): void {
  const result = asPostgres ? spawnSync("su", ["postgres", "-c", command], { encoding: "utf8" }) : spawnSync("sh", ["-c", command], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${command}\n${result.stderr}`);
}

function isRoot(): boolean {
  return typeof process.getuid === "function" && process.getuid() === 0;
}

export function openTestDatabase(): TestDatabase | undefined {
  const scratch = `sms_test_${randomBytes(5).toString("hex")}`;
  let admin: Connection | undefined;
  let stopCluster: (() => void) | undefined;
  let source = "";

  if (process.env["PGHOST"] !== undefined && process.env["SMS_TEST_DB_MODE"] !== "docker") {
    admin = createConnection({ mode: "host", user: process.env["PGUSER"] ?? "sms", database: "postgres" });
    source = "the server named by PGHOST";
  } else if (process.env["SMS_TEST_DB_MODE"] === "docker") {
    admin = createConnection({ mode: "docker", user: "sms", database: "postgres" });
    source = "the local Docker database";
  } else {
    const binaries = findBinaryDirectory();
    if (binaries !== undefined) {
      const folder = mkdtempSync(join(tmpdir(), "sms-pg-"));
      const asPostgres = isRoot();
      if (asPostgres) shell(`chown postgres '${folder}'`, false);
      const port = 40000 + Math.floor(Math.random() * 20000);
      shell(`'${binaries}/initdb' -D '${folder}/data' -A trust -U sms >/dev/null`, asPostgres);
      shell(`'${binaries}/pg_ctl' -D '${folder}/data' -o "-p ${port} -k '${folder}' -c listen_addresses=" -l '${folder}/log' -w start >/dev/null`, asPostgres);
      stopCluster = () => {
        try {
          shell(`'${binaries}/pg_ctl' -D '${folder}/data' -m immediate stop >/dev/null`, asPostgres);
        } finally {
          rmSync(folder, { recursive: true, force: true });
        }
      };
      admin = createConnection({ mode: "host", user: "sms", database: "postgres", env: { PGHOST: folder, PGPORT: String(port) } });
      source = `a temporary server (${binaries})`;
    } else {
      const ps = spawnSync("docker", ["compose", "-f", "infra/local/compose.yaml", "ps", "-q", "postgres"], { encoding: "utf8" });
      if (ps.status === 0 && ps.stdout.trim() !== "") {
        admin = createConnection({ mode: "docker", user: "sms", database: "postgres" });
        source = "the local Docker database";
      }
    }
  }
  if (admin === undefined) {
    if (process.env["SMS_REQUIRE_DB"] === "yes") throw new Error(`SMS_REQUIRE_DB=yes but ${SKIP_MESSAGE}`);
    return undefined;
  }

  const root = admin;
  root.run(`create database ${scratch};`);
  const connection = createConnection({ ...root.config, database: scratch });
  return {
    connection,
    source,
    close() {
      try {
        root.run(`drop database if exists ${scratch} with (force);`);
      } finally {
        stopCluster?.();
      }
    },
  };
}

/** Why the database tests were skipped, for the test report. With SMS_REQUIRE_DB=yes (set in CI) a skip becomes a failure. */
export const SKIP_MESSAGE = "no PostgreSQL available: install PostgreSQL, or start the local database with `npm run db:up` and set SMS_TEST_DB_MODE=docker";
