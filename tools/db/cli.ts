import { readFileSync } from "node:fs";
import { configFromEnvironment, createConnection, SqlError } from "./connection.ts";
import { assertSyntheticEnvironment, migrate, recreateDatabase, seed, setApplicationPassword, status } from "./migrate.ts";

const USAGE = `Usage: node tools/db/cli.ts <command> [--app core-api]

  status      which migrations are applied and which are pending
  migrate     apply the pending migrations
  provision   migrate, then give the application role its password (APP_PASSWORD_FILE); used on servers
  seed        add the synthetic data (local, staging and test only)
  reset       delete the local database, then migrate and seed (local and test only)

Where the database is (environment): PGHOST (default 127.0.0.1), PGPORT (5432), PGUSER (sms),
PGDATABASE (sms), PGPASSWORD or PGPASSWORD_FILE. SMS_ENV says what kind of environment this is.`;

const COMMANDS = ["status", "migrate", "provision", "seed", "reset"];

export async function main(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>> = process.env,
  out: (line: string) => void = (line) => void process.stdout.write(`${line}\n`),
): Promise<number> {
  const command = argv[0];
  const option = (name: string): string | undefined => {
    const index = argv.indexOf(`--${name}`);
    return index === -1 ? undefined : argv[index + 1];
  };
  if (command === undefined || !COMMANDS.includes(command)) {
    out(USAGE);
    return command === undefined ? 0 : 2;
  }
  const app = option("app") ?? "core-api";
  const root = process.cwd();
  try {
    const connection = createConnection(configFromEnvironment(env));
    if (command === "status") {
      const state = await status(connection, root, app);
      out(`${state.applied.length} applied, ${state.plan.pending.length} pending.`);
      for (const item of state.plan.pending) out(`  pending  ${item.scope}/${item.name}`);
      for (const item of state.plan.changed) out(`  EDITED   ${item.scope}/${item.name} (applied before, file changed since)`);
      return state.plan.changed.length > 0 ? 1 : 0;
    }
    if (command === "migrate" || command === "provision") {
      const result = await migrate(connection, root, app, out);
      out(result.applied.length === 0 ? "Nothing to apply: the database is up to date." : `Applied ${result.applied.length} migration(s).`);
      if (command === "provision") {
        const file = env["APP_PASSWORD_FILE"];
        if (file === undefined)
          throw new Error("provision needs APP_PASSWORD_FILE, the path of the file that holds the application password.");
        await setApplicationPassword(connection, readFileSync(file, "utf8").trim());
        out("The application role has its password.");
      }
      return 0;
    }
    if (command === "seed") {
      assertSyntheticEnvironment(env, "seed");
      const done = await seed(connection, root, app, out);
      out(done.length === 0 ? "No seed files." : `Seeded ${done.length} file(s).`);
      return 0;
    }
    assertSyntheticEnvironment(env, "reset the database");
    const local =
      connection.config.host === "127.0.0.1" || connection.config.host === "localhost" || connection.config.host.startsWith("/");
    if (!local && env["SMS_ALLOW_REMOTE_RESET"] !== "yes") {
      throw new Error(
        `Refusing to reset the database on ${connection.config.host}. Set SMS_ALLOW_REMOTE_RESET=yes only if that server is disposable.`,
      );
    }
    out(`Recreating database ${connection.config.database}.`);
    await recreateDatabase(connection);
    await migrate(connection, root, app, out);
    await seed(connection, root, app, out);
    out("Done.");
    return 0;
  } catch (error) {
    out(`Error: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof SqlError && error.output.trim() !== "") out(error.output.trim());
    return 1;
  }
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
