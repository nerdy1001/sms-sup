import type { Identity } from "../db/context.ts";

/**
 * Who may call a route. Every route has to say so, in its configuration:
 *
 *   app.get("/api/x", { config: { access: "public" }, ... }, handler)
 *   app.get("/api/y", { config: { access: ["administrator", "auditor"] }, ... }, handler)
 *
 * A route that does not say is refused when the application starts (see server.ts), so that nobody can
 * forget to protect one by leaving the line out.
 */
export type Access = "public" | readonly [string, ...string[]];

declare module "fastify" {
  interface FastifyContextConfig {
    access?: Access;
    /** For routes that are called every few seconds by machines: the request is logged at debug level, not info. */
    quiet?: boolean;
  }
  interface FastifyRequest {
    /** The signed-in staff member. Set before the handler runs on every route that is not public. */
    identity: Identity | null;
  }
}

export function isValidAccess(value: unknown): value is Access {
  if (value === "public") return true;
  return Array.isArray(value) && value.length > 0 && value.every((role) => typeof role === "string" && role !== "");
}
