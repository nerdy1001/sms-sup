import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export interface HealthOptions {
  /** The commit this build was made from. The deploy script checks that the new version answers. */
  readonly version: string;
}

/**
 * The placeholder of task FN-03: the smallest service that proves the path from the pipeline to
 * the staging server. Task FN-05 replaces it with the real web server and its routes.
 */
export function createHealthServer(options: HealthOptions): Server {
  const body = JSON.stringify({ status: "ok", service: "core-api", version: options.version });
  return createServer((request: IncomingMessage, response: ServerResponse) => {
    const path = (request.url ?? "").split("?")[0];
    const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
    if (path !== "/health") {
      response.writeHead(404, headers).end();
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { ...headers, allow: "GET, HEAD" }).end();
      return;
    }
    response.writeHead(200, { ...headers, "content-type": "application/json" });
    response.end(request.method === "HEAD" ? undefined : body);
  });
}
