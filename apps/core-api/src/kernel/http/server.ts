import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import fastify, { LogController } from "fastify";
import { serializerCompiler, validatorCompiler, type FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { installAudit } from "./audit-hooks.ts";
import type { Config } from "../config/load.ts";
import type { Database } from "../db/database.ts";
import { AppError, forbidden, unauthenticated } from "../errors/app-error.ts";
import { PROBLEM_MEDIA_TYPE, problemFromStatus } from "../errors/problem.ts";
import { errorFields, type Logger } from "../logging/logger.ts";
import { isValidAccess } from "./access.ts";
import { rejectEveryone, type Authenticator } from "./authentication.ts";
import { classify } from "./failure.ts";
import { healthRoutes } from "./health.ts";
import { openApiOptions } from "./openapi.ts";
import { generateRequestId, REQUEST_ID_HEADER } from "./request-id.ts";

/**
 * What a module provides to the web server: a function that, given what the kernel offers (the database),
 * returns the plugin that declares the module's routes. Each module exports one from its public API and
 * adds it to the list in src/routes.ts.
 */
export type ModuleRoutes = (context: { readonly database: Database }) => FastifyPluginAsyncZod;

export interface AppDependencies {
  readonly config: Pick<Config, "version" | "server">;
  readonly logger: Logger;
  readonly database: Database;
  /** Defaults to rejecting everyone until task AC-01 provides sign-in. */
  readonly authenticate?: Authenticator;
  /** The routes of the modules. Each is mounted under /api. */
  readonly modules?: readonly ModuleRoutes[];
  /** Overrides for tests. */
  readonly rateLimit?: { readonly max: number; readonly timeWindowMilliseconds: number };
}

/** Largest request body accepted: 1 MiB. Uploads of documents (module DM) will have their own, larger limit. */
const BODY_LIMIT_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MILLISECONDS = 30_000;
const DEFAULT_RATE_LIMIT = { max: 300, timeWindowMilliseconds: 60_000 } as const;

/**
 * Builds the web application. It does not listen on a port: main.ts does that, and tests call it with
 * app.inject(), which runs a request through everything below without a network.
 *
 * What every request goes through, in order: an identifier, the security headers, the rate limit, the
 * check of who is calling (for routes that are not public), the validation of the input against the
 * route's schema, the handler, and the serialisation of the answer against the route's response schema.
 * Anything that goes wrong becomes a problem details answer (see failure.ts) and nothing else.
 */
export async function createApp(dependencies: AppDependencies) {
  const { config, logger, database } = dependencies;
  const authenticate = dependencies.authenticate ?? rejectEveryone;
  const limit = dependencies.rateLimit ?? DEFAULT_RATE_LIMIT;

  const app = fastify({
    loggerInstance: logger,
    // Fastify's own request lines contain the full address, query string included. Ours (below) do not.
    logController: new LogController({ disableRequestLogging: true, requestIdLogLabel: "requestId" }),
    genReqId: generateRequestId,
    trustProxy: config.server.trustProxy,
    bodyLimit: BODY_LIMIT_BYTES,
    requestTimeout: REQUEST_TIMEOUT_MILLISECONDS,
  });

  // The API takes JSON and nothing else. Fastify also reads text/plain by default, but a web page of
  // another site can send text/plain across origins without any permission check, which is how
  // cross-site request forgery is attempted. With only application/json, the browser must ask first.
  app.removeContentTypeParser("text/plain");

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // A route that does not say who may call it is a mistake: refuse to start. This hook sees every
  // route registered after it, in every plugin.
  app.addHook("onRoute", (route) => {
    if (!isValidAccess(route.config?.access)) {
      const methods = Array.isArray(route.method) ? route.method.join(",") : route.method;
      throw new Error(
        `The route ${methods} ${route.url} does not say who may call it. Add config: { access: "public" } or config: { access: ["role"] }.`,
      );
    }
  });

  // The audit log: the rule for routes that change data, request.transaction, and the record of refusals.
  const auditing = installAudit(app, { database, logger });

  await app.register(swagger, openApiOptions());
  await app.register(helmet, {
    // An API never serves a page: nothing may be loaded or framed.
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
  });
  await app.register(rateLimit, {
    max: limit.max,
    timeWindow: limit.timeWindowMilliseconds,
    errorResponseBuilder: () => new AppError("rate_limited", "Too many requests: slow down and try again later."),
  });

  app.decorateRequest("identity", null);

  app.addHook("onRequest", async (request, reply) => {
    reply.header(REQUEST_ID_HEADER, request.id);
    // Answers contain personal data: no proxy and no browser may keep a copy.
    reply.header("cache-control", "no-store");

    const access = request.routeOptions.config.access;
    // No access setting means no route matched: the not-found answer below needs no sign-in.
    if (access === undefined || access === "public") return;

    const identity = await authenticate(request);
    if (identity === null) throw unauthenticated();
    if (!access.includes(identity.role)) {
      await auditing.recordDenied(request, identity, access);
      throw forbidden();
    }
    request.identity = identity;
  });

  app.addHook("onResponse", (request, reply, done) => {
    // The route as written ("/api/scholars/:id"), never the address as sent: addresses can hold identifiers and names.
    const fields = {
      method: request.method,
      route: request.routeOptions.url ?? "unmatched",
      status: reply.statusCode,
      durationMs: Math.round(reply.elapsedTime),
    };
    if (request.routeOptions.config.quiet === true) request.log.debug(fields, "request completed");
    else request.log.info(fields, "request completed");
    done();
  });

  app.setErrorHandler((error, request, reply) => {
    const failure = classify(error, request.id);
    if (failure.unexpected) request.log.error(errorFields(failure.error), "The request failed unexpectedly.");
    return reply.status(failure.problem.status).header("content-type", PROBLEM_MEDIA_TYPE).send(failure.problem);
  });

  app.setNotFoundHandler((request, reply) => {
    // A path that exists for other methods is "method not allowed" and says which ones are allowed.
    const path = request.url.split("?")[0] ?? "";
    const allowed = ["GET", "POST", "PUT", "PATCH", "DELETE"].filter((method) => app.hasRoute({ method: method, url: path }));
    if (allowed.length > 0) {
      return reply
        .status(405)
        .header("allow", allowed.join(", "))
        .header("content-type", PROBLEM_MEDIA_TYPE)
        .send(problemFromStatus(405, request.id));
    }
    return reply.status(404).header("content-type", PROBLEM_MEDIA_TYPE).send(problemFromStatus(404, request.id));
  });

  await app.register(healthRoutes({ version: config.version, database }));
  for (const routes of dependencies.modules ?? []) await app.register(routes({ database }), { prefix: "/api" });

  return app;
}

export type App = Awaited<ReturnType<typeof createApp>>;
