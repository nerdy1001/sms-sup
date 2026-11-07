import { spawn } from "node:child_process";
import { join } from "node:path";
import { findPrettyPrinter, PRETTY_ARGUMENTS, wantsPrettyLogs } from "./dev-pretty.ts";

/**
 * `npm run dev`: starts the staff API for development, and restarts it when a file changes.
 *
 * It exists only because setting an environment variable looks different on every system (`SMS_ENV=local node ...`
 * does not work in Windows PowerShell). It sets SMS_ENV to "local" unless you set it yourself, then runs
 * `node --watch` on the real entry point, so development runs the same program as staging and production.
 * When the library pino-pretty is installed, the logs are shown in a readable form; otherwise they are the
 * JSON lines that staging and production print (tools/dev-pretty.ts). SMS_LOG_PRETTY=off forces JSON.
 * The database is the one of `npm run db:up`; the defaults for "local" point at it (apps/core-api/src/kernel/config).
 */
const root = join(import.meta.dirname, "..");
const environment = { ...process.env, SMS_ENV: process.env["SMS_ENV"] ?? "local" };

console.log(`Starting the staff API (SMS_ENV=${environment["SMS_ENV"]}). It needs the database: npm run db:up, then npm run db:migrate.`);
console.log(`Health: http://${process.env["HOST"] ?? "127.0.0.1"}:${process.env["PORT"] ?? "3000"}/health   Press Ctrl+C to stop.\n`);

const printer = wantsPrettyLogs(process.env) ? findPrettyPrinter() : undefined;
if (printer === undefined && wantsPrettyLogs(process.env)) {
  console.log("The logs are JSON lines. For a readable form: npm install --save-dev pino-pretty (docs/guide/05-working-here.md).\n");
}

const child = spawn(process.execPath, ["--watch", "--watch-preserve-output", join("apps", "core-api", "src", "main.ts")], {
  cwd: root,
  env: environment,
  stdio: printer === undefined ? "inherit" : ["inherit", "pipe", "inherit"],
});
if (printer !== undefined && child.stdout !== null) {
  // Everything the application prints on standard output goes through pino-pretty; lines that are not JSON pass through unchanged.
  const pretty = spawn(process.execPath, [printer, ...PRETTY_ARGUMENTS], { stdio: [child.stdout, "inherit", "inherit"] });
  pretty.on("error", () => undefined);
}

// Ctrl+C reaches the child too (same terminal), and it stops itself cleanly; this program only waits for it.
process.on("SIGINT", () => undefined);
process.on("SIGTERM", () => child.kill("SIGTERM"));
child.on("exit", (code) => {
  process.exitCode = code ?? 0;
});
