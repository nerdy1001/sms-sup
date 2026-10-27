import { spawnSync } from "node:child_process";

/**
 * Talks to PostgreSQL through the command line client, psql. This avoids a database driver in the
 * tools (the repository depends on almost nothing) and runs the same way on every machine that has
 * either psql or Docker.
 *
 *   docker  runs psql inside the container of infra/local/compose.yaml (the default)
 *   host    runs psql from this computer; the usual PGHOST, PGPORT, PGUSER and PGPASSWORD settings apply
 */

export type Mode = "docker" | "host";

export interface ConnectionConfig {
  readonly mode: Mode;
  readonly user: string;
  readonly database: string;
  /** Used in docker mode: the Compose file and the name of the service. */
  readonly composeFile?: string;
  readonly service?: string;
  /** Extra environment for the psql process (host mode). */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Working directory for the docker command, so relative Compose paths resolve. */
  readonly cwd?: string;
}

export interface RunOptions {
  /** A database other than the configured one, for example "postgres" to create or drop databases. */
  readonly database?: string;
}

export interface Connection {
  readonly config: ConnectionConfig;
  /** Runs a script, stopping at the first error, and returns the plain output (no headers, no alignment). */
  run(sql: string, options?: RunOptions): string;
}

export class SqlError extends Error {
  readonly output: string;
  constructor(message: string, output: string) {
    super(message);
    this.name = "SqlError";
    this.output = output;
  }
}

export function createConnection(config: ConnectionConfig): Connection {
  const psqlArguments = (database: string): string[] => ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-d", database, "-f", "-"];

  const run = (sql: string, options: RunOptions = {}): string => {
    const database = options.database ?? config.database;
    let command: string;
    let args: string[];
    if (config.mode === "docker") {
      command = "docker";
      args = ["compose", "-f", config.composeFile ?? "infra/local/compose.yaml", "exec", "-T", config.service ?? "postgres", "psql", "-U", config.user, ...psqlArguments(database)];
    } else {
      command = "psql";
      args = [...psqlArguments(database)];
    }
    const result = spawnSync(command, args, {
      input: sql,
      encoding: "utf8",
      cwd: config.cwd,
      env: { ...process.env, ...(config.env ?? {}), ...(config.mode === "host" ? { PGUSER: config.user } : {}) },
      maxBuffer: 64 * 1024 * 1024,
    });
    if (result.error !== undefined) {
      const hint = config.mode === "docker" ? "Is Docker installed and running?" : "Is psql installed and on the PATH?";
      throw new SqlError(`Could not start ${command}: ${result.error.message}. ${hint}`, "");
    }
    if (result.status !== 0) {
      throw new SqlError(explain(config.mode, result.status, result.stderr), result.stderr);
    }
    return result.stdout;
  };

  return { config, run };
}

/** A message the person can act on. Docker problems get their own explanation, not a database one. */
export function explain(mode: Mode, status: number | null, stderr: string): string {
  if (mode === "docker" && /docker API|Docker daemon|docker\.sock|pipe\/docker/i.test(stderr)) {
    return "Docker is not running. Start Docker Desktop (or the Docker service), then try again.";
  }
  if (mode === "docker" && /service "?postgres"? is not running|no container found/i.test(stderr)) {
    return "The local database is not running. Start it with: npm run db:up";
  }
  return `PostgreSQL refused the script (exit code ${status}): ${firstLine(stderr)}`;
}

function firstLine(text: string): string {
  return text.split("\n").find((line) => line.trim() !== "")?.trim() ?? "no message";
}

/** A SQL string literal. Only for values the tools control (file names, checksums), never user input. */
export function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
