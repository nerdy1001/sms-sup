import { healthSchema, readySchema } from "@minesup/contracts";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { unavailable } from "../errors/app-error.ts";
import type { Database } from "../db/database.ts";

export interface HealthOptions {
  /** The commit this build was made from. The deploy script checks that the new version answers. */
  readonly version: string;
  readonly database: Pick<Database, "isReachable">;
}

/**
 * Two questions that a machine asks:
 *
 *   /health  Is the program running? It never touches the database, so a database outage does not make
 *            the platform restart a program that is working. The deploy script and the container
 *            health check use it.
 *   /ready   Can the program do its work? It asks the database. Use it to decide whether to send traffic.
 *
 * Both are public (they say nothing about the data), are not counted by the rate limit, and are not
 * logged above debug level, because they are called every few seconds.
 */
export const healthRoutes =
  (options: HealthOptions): FastifyPluginAsyncZod =>
  async (app) => {
    const quiet = { access: "public", rateLimit: false, quiet: true } as const;

    app.get(
      "/health",
      { config: quiet, schema: { summary: "Is the application running?", tags: ["operations"], response: { 200: healthSchema } } },
      () => ({
        status: "ok" as const,
        service: "core-api",
        version: options.version,
      }),
    );

    app.get(
      "/ready",
      {
        config: quiet,
        schema: { summary: "Can the application reach its database?", tags: ["operations"], response: { 200: readySchema } },
      },
      async () => {
        if (!(await options.database.isReachable())) throw unavailable("The database does not answer.");
        return { status: "ready" as const };
      },
    );
  };
