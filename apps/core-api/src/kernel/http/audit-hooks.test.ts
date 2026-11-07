import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Identity } from "../db/context.ts";
import type { Database, Queryable } from "../db/database.ts";
import type { Authenticator } from "./authentication.ts";
import { createApp } from "./server.ts";
import { createLogger } from "../logging/logger.ts";

/*
 * These tests send requests through the whole application with a stand-in for the database that behaves like
 * a transaction: what the work wrote is kept only if the work succeeds, so "committed" below is what a real
 * database would hold.
 */

const USER = "00000000-0000-4000-8000-000000000002";
const testAuthenticator: Authenticator = (request) => {
  const role = request.headers["x-test-role"];
  return Promise.resolve(typeof role === "string" ? { userId: USER, role } : null);
};
const attache = { "x-test-role": "attache" };
const auditor = { "x-test-role": "auditor" };

interface Statement {
  readonly text: string;
  readonly values: readonly unknown[];
  readonly identity: Identity | undefined;
}

function fakeDatabase(options: { failAuditWrites?: boolean } = {}) {
  const committed: Statement[] = [];
  let transactions = 0;
  async function inTransaction<T>(identity: Identity | undefined, work: (database: Queryable) => Promise<T>): Promise<T> {
    transactions += 1;
    const pending: Statement[] = [];
    const queryable: Queryable = {
      query<Row extends object>(text: string, values: readonly unknown[] = []) {
        if (options.failAuditWrites === true && text.startsWith("insert into platform.audit_log")) {
          return Promise.reject(new Error("the audit table refused the entry"));
        }
        pending.push({ text, values, identity });
        return Promise.resolve({ rows: [] as Row[], rowCount: 1 });
      },
    };
    const result = await work(queryable);
    committed.push(...pending);
    return result;
  }
  const database: Database = {
    asUser: (identity, work) => inTransaction(identity, work),
    withoutIdentity: (work) => inTransaction(undefined, work),
    isReachable: () => Promise.resolve(true),
    close: () => Promise.resolve(),
  };
  const audits = (): Statement[] => committed.filter((statement) => statement.text.startsWith("insert into platform.audit_log"));
  const changes = (): Statement[] => committed.filter((statement) => statement.text.startsWith("update "));
  return { database, audits, changes, transactions: () => transactions };
}

async function build(module: FastifyPluginAsyncZod, database: Database) {
  const lines: string[] = [];
  const app = await createApp({
    config: { version: "t", server: { host: "127.0.0.1", port: 0, trustProxy: false } },
    logger: createLogger({ level: "info", service: "core-api", version: "t" }, { write: (line: string) => void lines.push(line) }),
    database,
    authenticate: testAuthenticator,
    modules: [() => module],
  });
  return { app, logs: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>) };
}

async function withApp<T>(
  module: FastifyPluginAsyncZod,
  database: Database,
  work: (context: Awaited<ReturnType<typeof build>>) => Promise<T>,
) {
  const context = await build(module, database);
  try {
    return await work(context);
  } finally {
    await context.app.close();
  }
}

const SCHOLAR = "3f2c9d1e-0000-4000-8000-0000000000aa";
const declared = { action: "scholar.update", objectType: "scholar" };

const scholarRoutes: FastifyPluginAsyncZod = async (app) => {
  app.patch(
    "/scholars/:id",
    {
      config: { access: ["attache"], audit: declared },
      schema: { params: z.object({ id: z.string() }), response: { 200: z.object({ ok: z.boolean() }) } },
    },
    (request) =>
      request.transaction(async (database, audit) => {
        await database.query("update platform.users set full_name = $1 where id = $2", ["x", request.params.id]);
        audit.object(request.params.id, { changed_fields: 1 });
        return { ok: true };
      }),
  );
  app.patch("/fails/:id", { config: { access: ["attache"], audit: declared } }, (request) =>
    request.transaction(async (database) => {
      await database.query("update platform.users set full_name = 'x'");
      throw new Error("the work failed after a change");
    }),
  );
  app.post("/bulk", { config: { access: ["attache"], audit: { action: "scholar.import", objectType: "scholar" } } }, (request) =>
    request.transaction((_database, audit) => {
      for (const id of ["s1", "s2", "s3"]) audit.object(id);
      return Promise.resolve({ imported: 3 });
    }),
  );
  app.post(
    "/nothing-in-particular",
    { config: { access: ["attache"], audit: { action: "scholar.search", objectType: "scholar" } } },
    (request) => request.transaction(() => Promise.resolve({ found: 0 })),
  );
  app.get(
    "/scholars/:id",
    { config: { access: ["attache", "auditor"], audit: { action: "scholar.read", objectType: "scholar" } } },
    (request) =>
      request.transaction((_database, audit) => {
        audit.object((request.params as { id: string }).id);
        return Promise.resolve({ id: (request.params as { id: string }).id });
      }),
  );
  app.get("/reference", { config: { access: ["attache"] } }, () => ({ countries: ["CM"] }));
  app.patch("/forgetful/:id", { config: { access: ["attache"], audit: declared } }, () => ({ ok: true }));
  app.patch("/careless/:id", { config: { access: ["attache"], audit: declared } }, (request) =>
    request.transaction((_database, audit) => {
      audit.object("s1", { note: "awa@example.cm" });
      return Promise.resolve({ ok: true });
    }),
  );
  app.get("/open", { config: { access: "public" } }, () => ({ open: true }));
  app.post("/sign-in-like", { config: { access: "public" } }, () => ({ ok: true }));
  app.get("/misused", { config: { access: "public" } }, (request) => request.transaction(() => Promise.resolve({ ok: true })));
};

describe("which routes must declare an audit action", () => {
  const refuses = async (module: FastifyPluginAsyncZod, pattern: RegExp): Promise<void> => {
    await assert.rejects(build(module, fakeDatabase().database), pattern);
  };

  for (const method of ["post", "put", "patch", "delete"] as const) {
    test(`${method.toUpperCase()} without one stops the start and names the route`, () =>
      refuses(
        async (app) => {
          app[method]("/things", { config: { access: ["attache"] } }, () => ({ ok: true }));
        },
        new RegExp(`${method.toUpperCase()} /api/things changes data and does not declare an audit action`),
      ));
  }
  test("a route with several methods is checked for each of them", () =>
    refuses(async (app) => {
      app.route({ method: ["GET", "DELETE"], url: "/both", config: { access: ["attache"] }, handler: () => ({ ok: true }) });
    }, /GET,DELETE \/api\/both changes data/));
  test("a read does not need one", async () => {
    await withApp(scholarRoutes, fakeDatabase().database, async ({ app }) => {
      assert.equal((await app.inject({ method: "GET", url: "/api/reference", headers: attache })).statusCode, 200);
    });
  });
  test("a public route may change data without one, because nobody is signed in", async () => {
    await withApp(scholarRoutes, fakeDatabase().database, async ({ app }) => {
      assert.equal((await app.inject({ method: "POST", url: "/api/sign-in-like" })).statusCode, 200);
    });
  });
  test("a public route cannot declare one", () =>
    refuses(async (app) => {
      app.get("/x", { config: { access: "public", audit: declared } }, () => ({ ok: true }));
    }, /is public, so it cannot declare an audit action/));
  test("an invalid declaration stops the start", async () => {
    for (const audit of [
      { action: "update", objectType: "scholar" },
      { action: "scholar.update", objectType: "Scholar" },
      "scholar.update",
    ]) {
      await refuses(async (app) => {
        app.patch("/x", { config: { access: ["attache"], audit: audit as never } }, () => ({ ok: true }));
      }, /invalid audit action/);
    }
  });
});

describe("a write and its entry", () => {
  test("are committed together, in the name of the person who asked", async () => {
    const fake = fakeDatabase();
    await withApp(scholarRoutes, fake.database, async ({ app }) => {
      const response = await app.inject({ method: "PATCH", url: `/api/scholars/${SCHOLAR}`, headers: attache });
      assert.equal(response.statusCode, 200);
    });
    assert.equal(fake.changes().length, 1);
    assert.equal(fake.audits().length, 1);
    assert.deepEqual(fake.audits()[0]?.identity, { userId: USER, role: "attache" });
    assert.deepEqual(fake.audits()[0]?.values, [USER, "attache", ["scholar.update"], ["scholar"], [SCHOLAR], ['{"changed_fields":1}']]);
    assert.equal(fake.transactions(), 1, "the change and the entry share one transaction");
  });

  test("when the work fails, neither is kept", async () => {
    const fake = fakeDatabase();
    await withApp(scholarRoutes, fake.database, async ({ app }) => {
      const response = await app.inject({ method: "PATCH", url: "/api/fails/1", headers: attache });
      assert.equal(response.statusCode, 500);
    });
    assert.equal(fake.changes().length, 0);
    assert.equal(fake.audits().length, 0);
  });

  test("when the entry cannot be written, the change is not kept either", async () => {
    const fake = fakeDatabase({ failAuditWrites: true });
    await withApp(scholarRoutes, fake.database, async ({ app }) => {
      const response = await app.inject({ method: "PATCH", url: `/api/scholars/${SCHOLAR}`, headers: attache });
      assert.equal(response.statusCode, 500);
      assert.equal(response.json<{ code: string }>().code, "internal_error");
    });
    assert.equal(fake.changes().length, 0);
  });

  test("a detail that holds personal data stops the request and keeps nothing", async () => {
    const fake = fakeDatabase();
    await withApp(scholarRoutes, fake.database, async ({ app, logs }) => {
      const response = await app.inject({ method: "PATCH", url: "/api/careless/1", headers: attache });
      assert.equal(response.statusCode, 500);
      assert.doesNotMatch(response.body, /awa@example\.cm/);
      assert.doesNotMatch(JSON.stringify(logs()), /awa@example\.cm/);
    });
    assert.equal(fake.audits().length, 0);
  });

  test("a request that touches three records leaves three entries, in one statement", async () => {
    const fake = fakeDatabase();
    await withApp(scholarRoutes, fake.database, async ({ app }) => {
      assert.equal((await app.inject({ method: "POST", url: "/api/bulk", headers: attache })).statusCode, 200);
    });
    assert.equal(fake.audits().length, 1);
    assert.deepEqual((fake.audits()[0]?.values as unknown[])[4], ["s1", "s2", "s3"]);
  });

  test("a request that touches no particular record still leaves one entry", async () => {
    const fake = fakeDatabase();
    await withApp(scholarRoutes, fake.database, async ({ app }) => {
      await app.inject({ method: "POST", url: "/api/nothing-in-particular", headers: attache });
    });
    assert.deepEqual(fake.audits()[0]?.values, [USER, "attache", ["scholar.search"], ["scholar"], [null], ["{}"]]);
  });
});

describe("a read of personal data", () => {
  test("leaves an entry when its route declares one", async () => {
    const fake = fakeDatabase();
    await withApp(scholarRoutes, fake.database, async ({ app }) => {
      const response = await app.inject({ method: "GET", url: `/api/scholars/${SCHOLAR}`, headers: auditor });
      assert.equal(response.statusCode, 200);
    });
    assert.deepEqual(fake.audits()[0]?.values, [USER, "auditor", ["scholar.read"], ["scholar"], [SCHOLAR], ["{}"]]);
  });

  test("a read that declares nothing leaves nothing, and opens no transaction", async () => {
    const fake = fakeDatabase();
    await withApp(scholarRoutes, fake.database, async ({ app }) => {
      await app.inject({ method: "GET", url: "/api/reference", headers: attache });
    });
    assert.equal(fake.audits().length, 0);
    assert.equal(fake.transactions(), 0);
  });

  test("is not recorded when the read is refused as unsigned", async () => {
    const fake = fakeDatabase();
    await withApp(scholarRoutes, fake.database, async ({ app }) => {
      assert.equal((await app.inject({ method: "GET", url: `/api/scholars/${SCHOLAR}` })).statusCode, 401);
    });
    assert.equal(fake.audits().length, 0);
  });
});

describe("a module that forgot to use request.transaction", () => {
  test("is stopped at the answer: success is replaced by an error, and the log says why", async () => {
    await withApp(scholarRoutes, fakeDatabase().database, async ({ app, logs }) => {
      const response = await app.inject({ method: "PATCH", url: "/api/forgetful/1", headers: attache });
      assert.equal(response.statusCode, 500);
      assert.equal(response.json<{ code: string }>().code, "internal_error");
      assert.ok(logs().some((line) => line["msg"] === "A route declared an audit action but answered without recording it."));
    });
  });
  test("request.transaction on a public route is a mistake in the module", async () => {
    await withApp(scholarRoutes, fakeDatabase().database, async ({ app }) => {
      assert.equal((await app.inject({ method: "GET", url: "/api/misused" })).statusCode, 500);
    });
  });
});

describe("a refusal", () => {
  test("of a signed-in person is recorded, with the route as written and the roles that would have been allowed", async () => {
    const fake = fakeDatabase();
    await withApp(scholarRoutes, fake.database, async ({ app }) => {
      const response = await app.inject({ method: "PATCH", url: `/api/scholars/${SCHOLAR}`, headers: auditor });
      assert.equal(response.statusCode, 403);
    });
    assert.equal(fake.changes().length, 0);
    assert.deepEqual(fake.audits()[0]?.values, [
      USER,
      "auditor",
      ["access.denied"],
      ["route"],
      ["PATCH /api/scholars/:id"],
      ['{"allowed_roles":"attache","attempted_action":"scholar.update"}'],
    ]);
  });

  test("never holds what was sent: the address has an identifier in it, the entry does not", async () => {
    const fake = fakeDatabase();
    await withApp(scholarRoutes, fake.database, async ({ app }) => {
      await app.inject({ method: "PATCH", url: `/api/scholars/${SCHOLAR}?name=Awa`, headers: auditor, payload: { name: "Awa Mbarga" } });
    });
    assert.doesNotMatch(JSON.stringify(fake.audits()), new RegExp(`${SCHOLAR}|Awa`));
  });

  test("of someone who is not signed in is not recorded: there is nobody to name", async () => {
    const fake = fakeDatabase();
    await withApp(scholarRoutes, fake.database, async ({ app }) => {
      assert.equal((await app.inject({ method: "PATCH", url: `/api/scholars/${SCHOLAR}` })).statusCode, 401);
    });
    assert.equal(fake.audits().length, 0);
  });

  test("still stands when it cannot be recorded, and the failure is logged", async () => {
    const fake = fakeDatabase({ failAuditWrites: true });
    await withApp(scholarRoutes, fake.database, async ({ app, logs }) => {
      const response = await app.inject({ method: "PATCH", url: `/api/scholars/${SCHOLAR}`, headers: auditor });
      assert.equal(response.statusCode, 403);
      assert.ok(logs().some((line) => line["msg"] === "A refused request could not be recorded in the audit log."));
    });
  });
});
