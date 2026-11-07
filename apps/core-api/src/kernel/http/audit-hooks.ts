import type { FastifyInstance, FastifyRequest, RawReplyDefaultExpression, RawRequestDefaultExpression, RawServerDefault } from "fastify";
import type { Identity } from "../db/context.ts";
import type { Database, Queryable } from "../db/database.ts";
import { errorFields, type Logger } from "../logging/logger.ts";
import {
  createTrail,
  isValidDeclaration,
  WRITE_METHODS,
  writeAuditEntries,
  type AuditDeclaration,
  type AuditTrail,
} from "../audit/audit.ts";

/**
 * How a route takes part in the audit log. In the configuration of a route:
 *
 *   app.patch("/scholars/:id", { config: { access: ["attache"], audit: { action: "scholar.update", objectType: "scholar" } }, ... },
 *     (request) => request.transaction(async (database, audit) => {
 *       ... update the record with database.query(...) ...
 *       audit.object(request.params.id);
 *       return ...;
 *     }));
 *
 * `request.transaction` runs the work in one transaction as the signed-in person and writes the entry in that
 * same transaction. The change and its entry are committed together or not at all, and a module cannot
 * forget the entry, because the kernel writes it.
 *
 * What the kernel insists on:
 * - a route that changes data (POST, PUT, PATCH, DELETE) and is not public declares an audit action,
 *   or the application does not start;
 * - a route may declare one for a read too, and should for every read of personal data;
 * - a public route cannot declare one, because there is no signed-in person to record;
 * - a route that declares an action but answers with success without having written its entry is a bug
 *   in the module: the answer is replaced by an error, loudly, so that tests and staging show it.
 */

declare module "fastify" {
  interface FastifyContextConfig {
    audit?: AuditDeclaration;
  }
  interface FastifyRequest {
    /** True once the entry of this request's declared action was written. */
    auditRecorded: boolean;
    /** Runs `work` in one transaction as the signed-in person, and records the route's audit entry in it. */
    transaction<T>(work: (database: Queryable, audit: AuditTrail) => Promise<T>): Promise<T>;
  }
}

export interface Auditing {
  /** Records that a signed-in person was refused. Never throws: a failure to record is logged, the refusal stands. */
  recordDenied(request: FastifyRequest, identity: Identity, allowedRoles: readonly string[]): Promise<void>;
}

/** The application as `createApp` builds it: the default server with our logger. */
type App = FastifyInstance<RawServerDefault, RawRequestDefaultExpression, RawReplyDefaultExpression, Logger>;

export function installAudit(app: App, dependencies: { readonly database: Database; readonly logger: Logger }): Auditing {
  const { database, logger } = dependencies;

  app.addHook("onRoute", (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    const where = `${methods.join(",")} ${route.url}`;
    const declared: unknown = route.config?.audit;
    const isPublic = route.config?.access === "public";
    if (declared !== undefined && !isValidDeclaration(declared)) {
      throw new Error(`The route ${where} declares an invalid audit action. Use { action: "scholar.update", objectType: "scholar" }.`);
    }
    if (declared !== undefined && isPublic) {
      throw new Error(`The route ${where} is public, so it cannot declare an audit action: nobody is signed in to be recorded.`);
    }
    if (declared === undefined && !isPublic && methods.some((method) => WRITE_METHODS.has(method))) {
      throw new Error(
        `The route ${where} changes data and does not declare an audit action. Add config: { audit: { action, objectType } }.`,
      );
    }
  });

  app.decorateRequest("auditRecorded", false);
  app.decorateRequest("transaction", async function transaction<
    T,
  >(this: FastifyRequest, work: (database: Queryable, audit: AuditTrail) => Promise<T>): Promise<T> {
    const identity = this.identity;
    if (identity === null) throw new Error("request.transaction needs a signed-in person, and this route is public.");
    const declaration = this.routeOptions.config.audit;
    const collected = createTrail();
    const result = await database.asUser(identity, async (queryable) => {
      const value = await work(queryable, collected.trail);
      // In the same transaction: if this fails, the work is rolled back too.
      if (declaration !== undefined) await writeAuditEntries(queryable, identity, collected.entriesFor(declaration));
      return value;
    });
    if (declaration !== undefined) this.auditRecorded = true;
    return result;
  });

  // A route that declared an action and succeeded without writing it did its work outside request.transaction.
  app.addHook("onSend", (request, reply, payload, done) => {
    const declaration = request.routeOptions.config.audit;
    if (declaration !== undefined && reply.statusCode < 300 && !request.auditRecorded) {
      request.log.error({ action: declaration.action }, "A route declared an audit action but answered without recording it.");
      done(new Error(`The route did not record its audit action "${declaration.action}". Use request.transaction.`));
      return;
    }
    done(null, payload);
  });

  return {
    async recordDenied(request, identity, allowedRoles) {
      const declaration = request.routeOptions.config.audit;
      try {
        await database.asUser(identity, (queryable) =>
          writeAuditEntries(queryable, identity, [
            {
              action: "access.denied",
              objectType: "route",
              objectId: `${request.method} ${request.routeOptions.url ?? "unmatched"}`,
              detail: {
                allowed_roles: allowedRoles.join(","),
                ...(declaration === undefined ? {} : { attempted_action: declaration.action }),
              },
            },
          ]),
        );
      } catch (error) {
        logger.error(errorFields(error), "A refused request could not be recorded in the audit log.");
      }
    },
  };
}
