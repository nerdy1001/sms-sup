import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Database } from "../db/database.ts";
import { conflict } from "../errors/app-error.ts";
import { createLogger } from "../logging/logger.ts";
import type { Authenticator } from "./authentication.ts";
import { createApp, type AppDependencies } from "./server.ts";

/*
 * These tests send requests through the whole application with app.inject(): no network, no real
 * database. The sign-in used here exists only in this file: a test user is picked by a request header.
 */

const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
const testAuthenticator: Authenticator = (request) => {
  const role = request.headers["x-test-role"];
  return Promise.resolve(typeof role === "string" ? { userId: ADMIN_ID, role } : null);
};

const demoModule: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/things",
    {
      config: { access: ["administrator"], audit: { action: "thing.create", objectType: "thing" } },
      schema: {
        body: z.strictObject({ name: z.string().min(2), count: z.number().int() }),
        response: { 201: z.object({ id: z.string() }) },
      },
    },
    async (request, reply) => {
      await request.transaction((_database, audit) => {
        audit.object(request.body.name);
        return Promise.resolve();
      });
      return reply.status(201).send({ id: request.body.name });
    },
  );
  app.get(
    "/things/:id",
    {
      config: { access: ["administrator", "auditor"] },
      schema: { params: z.object({ id: z.string() }), querystring: z.object({ limit: z.coerce.number().int().max(100).optional() }) },
    },
    (request) => ({ who: request.identity?.role ?? null, id: request.params.id }),
  );
  app.get("/open", { config: { access: "public" }, schema: { response: { 200: z.object({ id: z.string() }) } } }, () => ({
    id: "1",
    nationalId: "123456789",
  }));
  app.get(
    "/wrong-answer",
    { config: { access: "public" }, schema: { response: { 200: z.object({ id: z.string() }) } } },
    () => ({ id: 3 }) as never,
  );
  app.get("/boom", { config: { access: "public" } }, () => {
    throw new Error("could not find awa@example.cm");
  });
  app.get("/taken", { config: { access: "public" } }, () => {
    throw conflict("That reference is already used.");
  });
  app.get("/ip", { config: { access: "public" } }, (request) => ({ ip: request.ip }));
};

function setup(overrides: Partial<AppDependencies> & { reachable?: boolean; trustProxy?: boolean; level?: "debug" | "info" } = {}) {
  const lines: string[] = [];
  const logger = createLogger(
    { level: overrides.level ?? "info", service: "core-api", version: "abc123" },
    { write: (line: string) => void lines.push(line) },
  );
  const database: Database = {
    // A stand-in: the work runs, and every query is accepted and answered with no rows.
    asUser: (_identity, work) => work({ query: () => Promise.resolve({ rows: [], rowCount: 0 }) }),
    withoutIdentity: () => Promise.reject(new Error("not used")),
    isReachable: () => Promise.resolve(overrides.reachable ?? true),
    close: () => Promise.resolve(),
  };
  const build = () =>
    createApp({
      config: { version: "abc123", server: { host: "127.0.0.1", port: 0, trustProxy: overrides.trustProxy ?? false } },
      logger,
      database,
      authenticate: testAuthenticator,
      modules: [() => demoModule],
      ...overrides,
    });
  return { build, lines, logs: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>) };
}

async function withApp<T>(
  overrides: Parameters<typeof setup>[0],
  work: (app: Awaited<ReturnType<typeof createApp>>, context: ReturnType<typeof setup>) => Promise<T>,
): Promise<T> {
  const context = setup(overrides);
  const app = await context.build();
  try {
    return await work(app, context);
  } finally {
    await app.close();
  }
}

describe("health and readiness", () => {
  test("/health says the program runs and which build it is", () =>
    withApp({}, async (app) => {
      const response = await app.inject({ method: "GET", url: "/health" });
      assert.equal(response.statusCode, 200);
      assert.match(String(response.headers["content-type"]), /^application\/json/);
      assert.deepEqual(response.json(), { status: "ok", service: "core-api", version: "abc123" });
      // The deploy script looks for exactly this text.
      assert.ok(response.body.includes('"version":"abc123"'));
    }));

  test("/health ignores a query string and answers HEAD without a body", () =>
    withApp({}, async (app) => {
      assert.equal((await app.inject({ method: "GET", url: "/health?probe=1" })).statusCode, 200);
      const head = await app.inject({ method: "HEAD", url: "/health" });
      assert.equal(head.statusCode, 200);
      assert.equal(head.body, "");
    }));

  test("/health does not ask the database, so an outage does not make it fail", () =>
    withApp({ reachable: false }, async (app) => {
      assert.equal((await app.inject({ method: "GET", url: "/health" })).statusCode, 200);
    }));

  test("/ready is 200 when the database answers", () =>
    withApp({}, async (app) => {
      const response = await app.inject({ method: "GET", url: "/ready" });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json(), { status: "ready" });
    }));

  test("/ready is 503 with the stable code when it does not, and says nothing about why", () =>
    withApp({ reachable: false }, async (app) => {
      const response = await app.inject({ method: "GET", url: "/ready" });
      assert.equal(response.statusCode, 503);
      assert.equal(response.json<{ code: string }>().code, "unavailable");
    }));
});

describe("every answer", () => {
  test("carries a request id, the security headers, and forbids caching", () =>
    withApp({}, async (app) => {
      const response = await app.inject({ method: "GET", url: "/health" });
      assert.match(String(response.headers["x-request-id"]), /^[0-9a-f-]{36}$/);
      assert.equal(response.headers["cache-control"], "no-store");
      assert.equal(response.headers["x-content-type-options"], "nosniff");
      assert.equal(response.headers["referrer-policy"], "no-referrer");
      assert.match(String(response.headers["content-security-policy"]), /default-src 'none'/);
      assert.match(String(response.headers["content-security-policy"]), /frame-ancestors 'none'/);
      assert.equal(response.headers["x-powered-by"], undefined);
    }));

  test("keeps a request id sent by the proxy when it is harmless, and replaces one that is not", () =>
    withApp({}, async (app) => {
      const kept = await app.inject({ method: "GET", url: "/health", headers: { "x-request-id": "proxy-req-0001" } });
      assert.equal(kept.headers["x-request-id"], "proxy-req-0001");
      for (const bad of ["short", "has spaces in it 123", "<script>alert(1)</script>", "x".repeat(200)]) {
        const replaced = await app.inject({ method: "GET", url: "/health", headers: { "x-request-id": bad } });
        assert.notEqual(replaced.headers["x-request-id"], bad);
        assert.match(String(replaced.headers["x-request-id"]), /^[0-9a-f-]{36}$/);
      }
    }));
});

describe("errors", () => {
  test("an unknown path is a 404 problem that carries the request id", () =>
    withApp({}, async (app) => {
      const response = await app.inject({ method: "GET", url: "/nowhere" });
      assert.equal(response.statusCode, 404);
      assert.match(String(response.headers["content-type"]), /^application\/problem\+json/);
      const body = response.json<{ code: string; type: string; requestId: string }>();
      assert.equal(body.code, "not_found");
      assert.equal(body.type, "urn:sms:error:not_found");
      assert.equal(body.requestId, response.headers["x-request-id"]);
    }));

  test("a path that exists for other methods is a 405 that lists them", () =>
    withApp({}, async (app) => {
      const response = await app.inject({ method: "DELETE", url: "/health" });
      assert.equal(response.statusCode, 405);
      assert.equal(response.json<{ code: string }>().code, "method_not_allowed");
      assert.match(String(response.headers["allow"]), /GET/);
    }));

  test("a failure that was raised on purpose keeps its code and its sentence", () =>
    withApp({}, async (app) => {
      const response = await app.inject({ method: "GET", url: "/api/taken" });
      assert.equal(response.statusCode, 409);
      const body = response.json<{ code: string; detail: string }>();
      assert.equal(body.code, "conflict");
      assert.equal(body.detail, "That reference is already used.");
    }));

  test("a bug is a 500 with no detail, and its message reaches neither the caller nor the log", () =>
    withApp({}, async (app, context) => {
      const response = await app.inject({ method: "GET", url: "/api/boom" });
      assert.equal(response.statusCode, 500);
      assert.equal(response.json<{ code: string }>().code, "internal_error");
      assert.ok(!response.body.includes("awa@example.cm"));
      assert.ok(!context.lines.join("").includes("awa@example.cm"));
      const errorLine = context.logs().find((line) => line["level"] === "error");
      assert.equal(errorLine?.["requestId"], response.headers["x-request-id"]);
      assert.equal(errorLine?.["errorType"], "Error");
    }));

  test("an answer that does not match its schema is a 500, never sent", () =>
    withApp({}, async (app) => {
      const response = await app.inject({ method: "GET", url: "/api/wrong-answer" });
      assert.equal(response.statusCode, 500);
      assert.deepEqual(Object.keys(response.json<object>()).sort(), ["code", "requestId", "status", "title", "type"]);
    }));

  test("a field that the response schema does not list is never sent", () =>
    withApp({}, async (app) => {
      const response = await app.inject({ method: "GET", url: "/api/open" });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json(), { id: "1" });
      assert.ok(!response.body.includes("123456789"));
    }));
});

describe("input", () => {
  const admin = { "x-test-role": "administrator" };

  test("a body that does not match says where and what kind, never the value", () =>
    withApp({}, async (app) => {
      const response = await app.inject({
        method: "POST",
        url: "/api/things",
        headers: admin,
        payload: { name: "SECRET-NAME", count: "many" },
      });
      assert.equal(response.statusCode, 400);
      const body = response.json<{ code: string; errors: { path: string; code: string }[] }>();
      assert.equal(body.code, "validation_failed");
      assert.deepEqual(body.errors, [{ path: "body.count", code: "invalid_type" }]);
      assert.ok(!response.body.includes("SECRET-NAME"));
      assert.ok(!response.body.includes("many"));
    }));

  test("a missing field and a field that is too short are both reported", () =>
    withApp({}, async (app) => {
      const response = await app.inject({ method: "POST", url: "/api/things", headers: admin, payload: { name: "a" } });
      const paths = response
        .json<{ errors: { path: string }[] }>()
        .errors.map((item) => item.path)
        .sort();
      assert.deepEqual(paths, ["body.count", "body.name"]);
    }));

  test("a field that the schema does not know is refused when the schema is strict", () =>
    withApp({}, async (app) => {
      const response = await app.inject({
        method: "POST",
        url: "/api/things",
        headers: admin,
        payload: { name: "ab", count: 1, role: "administrator" },
      });
      assert.equal(response.statusCode, 400);
      assert.equal(response.json<{ errors: { code: string }[] }>().errors[0]?.code, "unrecognized_keys");
    }));

  test("the query string is validated too", () =>
    withApp({}, async (app) => {
      const response = await app.inject({ method: "GET", url: "/api/things/7?limit=1000", headers: admin });
      assert.equal(response.statusCode, 400);
      assert.equal(response.json<{ errors: { path: string }[] }>().errors[0]?.path, "querystring.limit");
    }));

  test("text that is not JSON is a 400, and a content type that is not accepted is a 415", () =>
    withApp({}, async (app) => {
      const broken = await app.inject({
        method: "POST",
        url: "/api/things",
        headers: { ...admin, "content-type": "application/json" },
        payload: "{not json",
      });
      assert.equal(broken.statusCode, 400);
      assert.equal(broken.json<{ code: string }>().code, "validation_failed");
      const text = await app.inject({
        method: "POST",
        url: "/api/things",
        headers: { ...admin, "content-type": "text/plain" },
        payload: "hello",
      });
      assert.equal(text.statusCode, 415);
      assert.equal(text.json<{ code: string }>().code, "unsupported_media_type");
    }));

  test("a body larger than one mebibyte is a 413", () =>
    withApp({}, async (app) => {
      const response = await app.inject({
        method: "POST",
        url: "/api/things",
        headers: { ...admin, "content-type": "application/json" },
        payload: JSON.stringify({ name: "x".repeat(1024 * 1024 + 10), count: 1 }),
      });
      assert.equal(response.statusCode, 413);
      assert.equal(response.json<{ code: string }>().code, "payload_too_large");
    }));

  test("a body cannot change the prototype of an object", () =>
    withApp({}, async (app) => {
      const response = await app.inject({
        method: "POST",
        url: "/api/things",
        headers: { ...admin, "content-type": "application/json" },
        payload: '{"name":"ab","count":1,"__proto__":{"admin":true}}',
      });
      assert.equal(response.statusCode, 400);
    }));
});

describe("who may call a route", () => {
  test("a route that does not say refuses to let the application start, and names the route", async () => {
    const forgetful: FastifyPluginAsyncZod = async (app) => {
      app.get("/forgot", () => ({ ok: true }));
    };
    await assert.rejects(setup({ modules: [() => forgetful] }).build(), /GET \/api\/forgot does not say who may call it/);
  });

  test("an empty list of roles, or something that is not a role list, is refused too", async () => {
    for (const access of [[], "everyone", undefined, [""], 7]) {
      const plugin: FastifyPluginAsyncZod = async (app) => {
        app.get("/x", { config: { access: access as never } }, () => ({ ok: true }));
      };
      await assert.rejects(setup({ modules: [() => plugin] }).build(), /does not say who may call it/, JSON.stringify(access));
    }
  });

  test("a route with several methods is checked too", async () => {
    const plugin: FastifyPluginAsyncZod = async (app) => {
      app.route({ method: ["GET", "POST"], url: "/both", handler: () => ({ ok: true }) });
    };
    await assert.rejects(setup({ modules: [() => plugin] }).build(), /GET,POST \/api\/both/);
  });

  test("nobody is signed in until sign-in exists: a route for roles answers 401", () =>
    withApp({ authenticate: undefined as never }, async (app) => {
      // `authenticate: undefined` is not allowed by the type; the default must apply.
      const response = await app.inject({ method: "GET", url: "/api/things/1", headers: { "x-test-role": "administrator" } });
      assert.equal(response.statusCode, 401);
    }));

  test("without credentials: 401 with the stable code", () =>
    withApp({}, async (app) => {
      const response = await app.inject({ method: "GET", url: "/api/things/1" });
      assert.equal(response.statusCode, 401);
      assert.equal(response.json<{ code: string }>().code, "unauthenticated");
    }));

  test("with the wrong role: 403", () =>
    withApp({}, async (app) => {
      const response = await app.inject({ method: "GET", url: "/api/things/1", headers: { "x-test-role": "attache" } });
      assert.equal(response.statusCode, 403);
      assert.equal(response.json<{ code: string }>().code, "forbidden");
    }));

  test("with a listed role: the handler runs and sees who is calling", () =>
    withApp({}, async (app) => {
      const response = await app.inject({ method: "GET", url: "/api/things/42", headers: { "x-test-role": "auditor" } });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json(), { who: "auditor", id: "42" });
    }));

  test("the check comes before the validation: a caller who is not signed in learns nothing about the input", () =>
    withApp({}, async (app) => {
      const response = await app.inject({ method: "POST", url: "/api/things", payload: { nonsense: true } });
      assert.equal(response.statusCode, 401);
      assert.equal(response.json<{ errors?: unknown }>().errors, undefined);
    }));

  test("a public route needs no sign-in", () =>
    withApp({}, async (app) => {
      assert.equal((await app.inject({ method: "GET", url: "/api/open" })).statusCode, 200);
    }));
});

describe("the rate limit", () => {
  test("refuses with 429 and the stable code once the limit is used up, and says when to retry", () =>
    withApp({ rateLimit: { max: 3, timeWindowMilliseconds: 60_000 } }, async (app) => {
      const statuses: number[] = [];
      let last;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        last = await app.inject({ method: "GET", url: "/api/open" });
        statuses.push(last.statusCode);
      }
      assert.deepEqual(statuses, [200, 200, 200, 429, 429]);
      assert.equal(last?.json<{ code: string }>().code, "rate_limited");
      assert.ok(last?.headers["retry-after"] !== undefined);
    }));

  test("the health checks are not counted", () =>
    withApp({ rateLimit: { max: 2, timeWindowMilliseconds: 60_000 } }, async (app) => {
      for (let attempt = 0; attempt < 10; attempt += 1) assert.equal((await app.inject({ method: "GET", url: "/health" })).statusCode, 200);
      assert.equal((await app.inject({ method: "GET", url: "/ready" })).statusCode, 200);
    }));

  test("the address behind a proxy is believed only when the proxy is trusted", async () => {
    const asked = (trustProxy: boolean) =>
      withApp(
        { trustProxy },
        async (app) =>
          (await app.inject({ method: "GET", url: "/api/ip", headers: { "x-forwarded-for": "203.0.113.9" } })).json<{ ip: string }>().ip,
      );
    assert.equal(await asked(false), "127.0.0.1");
    assert.equal(await asked(true), "203.0.113.9");
  });
});

describe("the log", () => {
  test("a request leaves one line with the method, the route as written, the status and the duration", () =>
    withApp({}, async (app, context) => {
      const response = await app.inject({
        method: "GET",
        url: "/api/things/ID-12345?token=abc&email=awa@example.cm",
        headers: { "x-test-role": "auditor", authorization: "Bearer SECRET-TOKEN" },
      });
      const line = context.logs().find((entry) => entry["msg"] === "request completed");
      assert.equal(line?.["method"], "GET");
      assert.equal(line?.["route"], "/api/things/:id");
      assert.equal(line?.["status"], 200);
      assert.equal(typeof line?.["durationMs"], "number");
      assert.equal(line?.["requestId"], response.headers["x-request-id"]);
      const text = context.lines.join("");
      for (const secret of ["ID-12345", "token=abc", "awa@example.cm", "SECRET-TOKEN"]) assert.ok(!text.includes(secret), secret);
    }));

  test("a body is never logged, not even when it is wrong", () =>
    withApp({}, async (app, context) => {
      await app.inject({
        method: "POST",
        url: "/api/things",
        headers: { "x-test-role": "administrator" },
        payload: { name: "SECRET-NAME", count: "SECRET-COUNT" },
      });
      assert.ok(!context.lines.join("").includes("SECRET"));
    }));

  test("an address that matches no route is logged as unmatched, not as sent", () =>
    withApp({}, async (app, context) => {
      await app.inject({ method: "GET", url: "/scholars/awa-example" });
      const line = context.logs().find((entry) => entry["msg"] === "request completed");
      assert.equal(line?.["route"], "unmatched");
      assert.ok(!context.lines.join("").includes("awa-example"));
    }));

  test("the health checks are logged only at debug level", async () => {
    await withApp({}, async (app, context) => {
      await app.inject({ method: "GET", url: "/health" });
      assert.equal(context.lines.length, 0);
    });
    await withApp({ level: "debug" }, async (app, context) => {
      await app.inject({ method: "GET", url: "/health" });
      assert.equal(context.logs()[0]?.["level"], "debug");
    });
  });
});
