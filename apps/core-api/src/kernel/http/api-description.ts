import { createLogger } from "../logging/logger.ts";
import { createApp, type ModuleRoutes } from "./server.ts";

/**
 * The OpenAPI description of the API, as the text of docs/api/openapi.json. It is built from the same
 * route definitions that serve requests, so it cannot drift from them. The application is built but never
 * started, and its database is a stand-in that is never asked anything.
 */
export async function describeApi(modules: readonly ModuleRoutes[]): Promise<string> {
  const app = await createApp({
    config: { version: "description", server: { host: "127.0.0.1", port: 0, trustProxy: false } },
    logger: createLogger({ level: "silent", service: "core-api", version: "description" }),
    database: {
      asUser: () => Promise.reject(new Error("The API description does not use the database.")),
      withoutIdentity: () => Promise.reject(new Error("The API description does not use the database.")),
      isReachable: () => Promise.resolve(true),
      close: () => Promise.resolve(),
    },
    modules,
  });
  try {
    await app.ready();
    return `${JSON.stringify(app.swagger(), null, 2)}\n`;
  } finally {
    await app.close();
  }
}
