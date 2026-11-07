import { readFileSync } from "node:fs";
import pg from "pg";

/**
 * Talks to PostgreSQL through the same driver the application uses (pg). It used to send scripts to the
 * command line client, psql, which needed psql or Docker on every machine that ran a migration. The
 * driver needs neither, which is what lets the same runner migrate the staging database from inside the
 * application image.
 *
 * Where the database is: the usual PGHOST, PGPORT, PGUSER, PGDATABASE and PGPASSWORD settings. Without
 * them the runner connects to 127.0.0.1:5432 as "sms", which is the local container of
 * infra/local/compose.yaml (npm run db:up). A host that starts with "/" is a folder holding a Unix socket.
 */

export interface ConnectionConfig {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly database: string;
  readonly password?: string | undefined;
}

export interface RunOptions {
  /** A database other than the configured one, for example "postgres" to create or drop databases. */
  readonly database?: string;
}

export interface Connection {
  readonly config: ConnectionConfig;
  /**
   * Runs a script (several statements are fine, and share one session), stopping at the first error.
   * Returns the rows of every statement that produced rows as plain text: one line per row, columns
   * joined by "|", nothing for null, "t" and "f" for booleans (the format psql -At prints).
   */
  run(sql: string, options?: RunOptions): Promise<string>;
  /** One statement with parameters ($1, $2). Use it for any value that is not a constant of ours. */
  query(sql: string, parameters: readonly string[], options?: RunOptions): Promise<string[][]>;
}

export class SqlError extends Error {
  readonly output: string;
  constructor(message: string, output: string) {
    super(message);
    this.name = "SqlError";
    this.output = output;
  }
}

/** Reads the settings from the environment. PGPASSWORD_FILE names a file that holds the password (Docker secrets). */
export function configFromEnvironment(
  env: Readonly<Record<string, string | undefined>>,
  readFile: (path: string) => string = (path) => readFileSync(path, "utf8"),
): ConnectionConfig {
  const port = Number(env["PGPORT"] ?? "5432");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`PGPORT is "${env["PGPORT"]}", which is not a port number.`);
  const file = env["PGPASSWORD_FILE"];
  if (file !== undefined && env["PGPASSWORD"] !== undefined) throw new Error("Set PGPASSWORD or PGPASSWORD_FILE, not both.");
  let password = env["PGPASSWORD"];
  if (file !== undefined) {
    try {
      password = readFile(file).trim();
    } catch (error) {
      throw new Error(
        `PGPASSWORD_FILE is set to ${file} but that file cannot be read (${error instanceof Error ? error.message : String(error)}).`,
        { cause: error },
      );
    }
  }
  return { host: env["PGHOST"] ?? "127.0.0.1", port, user: env["PGUSER"] ?? "sms", database: env["PGDATABASE"] ?? "sms", password };
}

const AS_TEXT = { getTypeParser: () => (value: string) => value };

function format(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  return JSON.stringify(value);
}

export function createConnection(config: ConnectionConfig): Connection {
  const open = async <T>(options: RunOptions, work: (client: pg.Client) => Promise<T>): Promise<T> => {
    const client = new pg.Client({
      host: config.host,
      port: config.port,
      user: config.user,
      database: options.database ?? config.database,
      ...(config.password === undefined ? {} : { password: config.password }),
      connectionTimeoutMillis: 5000,
    });
    // A connection that dies while idle would otherwise end the process with an uncaught error.
    client.on("error", () => {});
    try {
      await client.connect();
    } catch (error) {
      throw new SqlError(explain(config, error), "");
    }
    try {
      return await work(client);
    } catch (error) {
      if (error instanceof SqlError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      const code = (error as { code?: string }).code;
      throw new SqlError(`PostgreSQL refused the script${code === undefined ? "" : ` (code ${code})`}: ${message}`, `ERROR:  ${message}`);
    } finally {
      await client.end().catch(() => {});
    }
  };

  const run = (sql: string, options: RunOptions = {}): Promise<string> =>
    open(options, async (client) => {
      // No parameters, so the simple protocol is used and a script of many statements is allowed.
      const answer = (await client.query({ text: sql, rowMode: "array", types: AS_TEXT })) as unknown as
        pg.QueryArrayResult | pg.QueryArrayResult[];
      const results = Array.isArray(answer) ? answer : [answer];
      const lines: string[] = [];
      for (const result of results) for (const row of result.rows) lines.push(row.map(format).join("|"));
      return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
    });

  const query = (sql: string, parameters: readonly string[], options: RunOptions = {}): Promise<string[][]> =>
    open(options, async (client) => {
      const result = await client.query({ text: sql, values: [...parameters], rowMode: "array", types: AS_TEXT });
      return result.rows.map((row: unknown[]) => row.map(format));
    });

  return { config, run, query };
}

/** A message the person can act on. */
export function explain(config: ConnectionConfig, error: unknown): string {
  const where = config.host.startsWith("/") ? `the socket in ${config.host}` : `${config.host}:${config.port}`;
  const code = (error as { code?: string }).code;
  const message = error instanceof Error ? error.message : String(error);
  if (code === "ECONNREFUSED" || code === "ENOENT" || /ECONNREFUSED/.test(message)) {
    return `Cannot reach PostgreSQL at ${where}. For the local database, start it with: npm run db:up (it needs Docker running).`;
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return `The database host "${config.host}" cannot be found.`;
  if (/timeout/i.test(message)) return `PostgreSQL at ${where} did not answer in 5 seconds.`;
  if (code === "28P01" || code === "28000") return `PostgreSQL at ${where} refused the login for user "${config.user}" (${message}).`;
  if (code === "3D000") return `The database "${config.database}" does not exist on ${where}. Create it, or run: npm run db:reset`;
  return `Could not connect to PostgreSQL at ${where}: ${message}`;
}

/** A SQL string literal. Only for constants of ours (file names, checksums), never for input or secrets: use query() with parameters. */
export function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
