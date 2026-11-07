import { readFileSync } from "node:fs";
import { ConfigError, loadConfig, type Config } from "./kernel/config/load.ts";
import { startApplication } from "./kernel/http/start.ts";
import { createLogger, errorFields } from "./kernel/logging/logger.ts";
import { moduleRoutes } from "./routes.ts";

/** How long a stop may take before the process gives up and ends anyway. */
const STOP_LIMIT_MILLISECONDS = 10_000;

async function main(): Promise<void> {
  let config: Config;
  try {
    config = loadConfig(process.env, (path) => readFileSync(path, "utf8"));
  } catch (error) {
    // The logger needs the configuration, so this one message goes straight to standard error. It names variables, never values.
    process.stderr.write(`${error instanceof ConfigError ? error.message : "The configuration could not be read."}\n`);
    process.exitCode = 1;
    return;
  }

  const logger = createLogger({ level: config.log.level, service: "core-api", version: config.version });
  const application = await startApplication(config, logger, { modules: moduleRoutes });

  let stopping = false;
  const stop = (reason: string, exitCode: number): void => {
    if (stopping) return;
    stopping = true;
    logger.info({ reason }, "The application is stopping.");
    // If something hangs (a request that never ends), do not keep the container waiting for ever.
    setTimeout(() => process.exit(1), STOP_LIMIT_MILLISECONDS).unref();
    application.stop().then(
      () => process.exit(exitCode),
      (error: unknown) => {
        logger.error(errorFields(error), "The application did not stop cleanly.");
        process.exit(1);
      },
    );
  };

  // The container platform sends SIGTERM; a developer pressing Ctrl+C sends SIGINT.
  for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => stop(signal, 0));
  // A bug that nobody caught leaves the program in an unknown state: log it (safely) and let the platform restart it.
  process.on("uncaughtException", (error) => {
    logger.fatal(errorFields(error), "An uncaught error ended the application.");
    stop("uncaughtException", 1);
  });
  process.on("unhandledRejection", (error) => {
    logger.fatal(errorFields(error), "An unhandled promise rejection ended the application.");
    stop("unhandledRejection", 1);
  });
}

main().catch((error: unknown) => {
  process.stderr.write(`The application could not start (${error instanceof Error ? error.name : "unknown error"}).\n`);
  process.exitCode = 1;
});
