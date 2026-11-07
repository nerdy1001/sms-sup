import type { Config } from "../config/load.ts";
import { createDatabase } from "../db/database.ts";
import type { Logger } from "../logging/logger.ts";
import { createApp, type AppDependencies } from "./server.ts";

export interface RunningApplication {
  /** The address the server listens on. With port 0 in the configuration this is the port that was chosen. */
  readonly host: string;
  readonly port: number;
  /** Stops accepting requests, lets the ones in progress finish, then closes the database connections. */
  stop(): Promise<void>;
}

export type StartOptions = Pick<AppDependencies, "authenticate" | "modules">;

/** Connects to the database (lazily: the first query opens the first connection) and starts listening. */
export async function startApplication(config: Config, logger: Logger, options: StartOptions = {}): Promise<RunningApplication> {
  const database = createDatabase(config.database, logger);
  try {
    const app = await createApp({ config, logger, database, ...options });
    await app.listen({ host: config.server.host, port: config.server.port });
    const address = app.server.address();
    const port = typeof address === "object" && address !== null ? address.port : config.server.port;
    logger.info({ env: config.env, host: config.server.host, port, databaseHost: config.database.host }, "The application is listening.");
    return {
      host: config.server.host,
      port,
      async stop() {
        // In this order: first stop taking requests, then close the database they were using.
        await app.close();
        await database.close();
      },
    };
  } catch (error) {
    await database.close();
    throw error;
  }
}
