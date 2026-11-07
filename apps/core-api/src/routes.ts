import type { ModuleRoutes } from "./kernel/http/server.ts";

/**
 * The routes of the modules, in one list. A module adds one line here when it has routes, for example:
 *
 *   import { registryRoutes } from "./modules/registry/index.ts";
 *   export const moduleRoutes: readonly ModuleRoutes[] = [registryRoutes];
 *
 * main.ts starts the server with this list, and so does the script that writes the API description
 * (npm run api:docs), so the document always covers every route that exists.
 */
export const moduleRoutes: readonly ModuleRoutes[] = [];
