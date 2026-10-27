import { createConnection, SqlError, type ConnectionConfig, type Mode } from "./connection.ts";
import { assertSyntheticEnvironment, migrate, recreateDatabase, seed, status } from "./migrate.ts";

const USAGE = `Usage: node tools/db/cli.ts <command> [--app core-api] [--mode docker|host]

  status    which migrations are applied and which are pending
  migrate   apply the pending migrations
  seed      add the synthetic data (local, staging and test only)
  reset     delete the local database, then migrate and seed (local and test only)

Settings (environment): SMS_DB_MODE (docker or host), PGUSER (default sms), PGDATABASE (default sms), SMS_ENV.`;

export function configFromEnvironment(env: Readonly<Record<string, string | undefined>>, mode?: string): ConnectionConfig {
  const chosen = (mode ?? env["SMS_DB_MODE"] ?? "docker") as Mode;
  if (chosen !== "docker" && chosen !== "host") throw new Error(`Unknown mode "${chosen}". Use docker or host.`);
  return { mode: chosen, user: env["PGUSER"] ?? "sms", database: env["PGDATABASE"] ?? "sms" };
}

function main(argv: readonly string[]): number {
  const command = argv[0];
  const option = (name: string): string | undefined => {
    const index = argv.indexOf(`--${name}`);
    return index === -1 ? undefined : argv[index + 1];
  };
  const out = (line: string): void => void process.stdout.write(`${line}\n`);
  if (command === undefined || !["status", "migrate", "seed", "reset"].includes(command)) {
    out(USAGE);
    return command === undefined ? 0 : 2;
  }
  const app = option("app") ?? "core-api";
  const root = process.cwd();
  try {
    const connection = createConnection({ ...configFromEnvironment(process.env, option("mode")), cwd: root });
    if (command === "status") {
      const state = status(connection, root, app);
      out(`${state.applied.length} applied, ${state.plan.pending.length} pending.`);
      for (const item of state.plan.pending) out(`  pending  ${item.scope}/${item.name}`);
      for (const item of state.plan.changed) out(`  EDITED   ${item.scope}/${item.name} (applied before, file changed since)`);
      return state.plan.changed.length > 0 ? 1 : 0;
    }
    if (command === "migrate") {
      const result = migrate(connection, root, app, out);
      out(result.applied.length === 0 ? "Nothing to apply: the database is up to date." : `Applied ${result.applied.length} migration(s).`);
      return 0;
    }
    if (command === "seed") {
      assertSyntheticEnvironment(process.env, "seed");
      const done = seed(connection, root, app, out);
      out(done.length === 0 ? "No seed files." : `Seeded ${done.length} file(s).`);
      return 0;
    }
    assertSyntheticEnvironment(process.env, "reset the database");
    if (connection.config.mode === "host" && process.env["SMS_ALLOW_HOST_RESET"] !== "yes") {
      throw new Error('Refusing to reset a database reached from this computer\'s psql settings. Set SMS_ALLOW_HOST_RESET=yes if PGHOST points at a disposable database.');
    }
    out(`Recreating database ${connection.config.database}.`);
    recreateDatabase(connection);
    migrate(connection, root, app, out);
    seed(connection, root, app, out);
    out("Done.");
    return 0;
  } catch (error) {
    out(`Error: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof SqlError && error.output.trim() !== "") out(error.output.trim());
    return 1;
  }
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
