import { Secret } from "./secret.ts";
import { ENVIRONMENTS, environmentSchema, SECRET_FILE_VARIABLES, type Environment } from "./schema.ts";

export interface Config {
  readonly env: Environment;
  readonly version: string;
  readonly server: {
    readonly host: string;
    readonly port: number;
    /** Whether to believe the client address that the reverse proxy reports (X-Forwarded-For). */
    readonly trustProxy: boolean;
  };
  readonly log: { readonly level: "fatal" | "error" | "warn" | "info" | "debug" | "trace" };
  readonly database: {
    readonly host: string;
    readonly port: number;
    readonly name: string;
    readonly user: string;
    /** Absent only in local and test, where the database trusts connections from this computer. */
    readonly password: Secret | undefined;
  };
}

/** Raised at start when the settings are wrong. The message names the variables, never their values. */
export class ConfigError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(`Invalid configuration:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`);
    this.name = "ConfigError";
    this.problems = problems;
  }
}

export type Env = Readonly<Record<string, string | undefined>>;
/** Reads the text of a file. Passed in so that tests need no real files. */
export type FileReader = (path: string) => string;

const isDevelopment = (env: Environment): boolean => env === "local" || env === "test";

/**
 * Turns the environment into a typed, frozen Config, or throws a ConfigError that lists every problem
 * at once (so that one run shows all of them).
 */
export function loadConfig(source: Env, readFile: FileReader): Config {
  const problems: string[] = [];

  // An empty variable is treated as missing: a stray `PORT=` must not become port 0.
  const input: Record<string, string> = {};
  for (const key of Object.keys(environmentSchema.shape)) {
    const value = source[key];
    if (value !== undefined && value.trim() !== "") input[key] = value;
  }

  const parsed = environmentSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const name = String(issue.path[0] ?? "environment");
      problems.push(input[name] === undefined ? `${name} is required` : issue.message);
    }
    throw new ConfigError(problems);
  }
  const values = parsed.data;

  if (values.DATABASE_HOST === undefined && !isDevelopment(values.SMS_ENV)) {
    problems.push(`DATABASE_HOST is required when SMS_ENV is ${values.SMS_ENV}`);
  }

  let password: Secret | undefined;
  const passwordFile = (source["DATABASE_PASSWORD_FILE"] ?? "").trim();
  if (passwordFile !== "") {
    try {
      const content = readFile(passwordFile).replace(/\r?\n$/, "");
      if (content === "") problems.push("DATABASE_PASSWORD_FILE points to an empty file");
      else password = new Secret(content);
    } catch {
      problems.push("DATABASE_PASSWORD_FILE cannot be read (check the path and the permissions)");
    }
  } else if (!isDevelopment(values.SMS_ENV)) {
    problems.push(`DATABASE_PASSWORD_FILE is required when SMS_ENV is ${values.SMS_ENV}`);
  }

  // A secret given directly in the environment ends up in process listings and crash dumps.
  for (const name of ["DATABASE_PASSWORD", "DB_PASSWORD"]) {
    if ((source[name] ?? "") !== "") problems.push(`${name} is not accepted: give the secret as a file with DATABASE_PASSWORD_FILE`);
  }

  if (problems.length > 0) throw new ConfigError(problems);

  const config: Config = {
    env: values.SMS_ENV,
    version: values.APP_VERSION,
    server: Object.freeze({ host: values.HOST, port: values.PORT, trustProxy: values.TRUST_PROXY === "true" }),
    log: Object.freeze({ level: values.LOG_LEVEL }),
    database: Object.freeze({
      host: values.DATABASE_HOST ?? "127.0.0.1",
      port: values.DATABASE_PORT,
      name: values.DATABASE_NAME,
      user: values.DATABASE_USER,
      password,
    }),
  };
  return Object.freeze(config);
}

export { ENVIRONMENTS, SECRET_FILE_VARIABLES };
