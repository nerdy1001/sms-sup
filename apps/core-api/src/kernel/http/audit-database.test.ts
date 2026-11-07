import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { migrate, recreateDatabase, seed } from "../../../../../tools/db/migrate.ts";
import { openTestDatabase, SKIP_MESSAGE, type TestDatabase } from "../../../../../tools/db/test-database.ts";
import { loadConfig } from "../config/load.ts";
import { createDatabase, type Database } from "../db/database.ts";
import type { Authenticator } from "./authentication.ts";
import { createApp, type App } from "./server.ts";
import { createLogger } from "../logging/logger.ts";

/*
 * The audit hooks against a real PostgreSQL, as the application role, so that the row-level security
 * policy of the audit table and the transaction are the real ones.
 */

const REPOSITORY = join(import.meta.dirname, "..", "..", "..", "..", "..");
const ADMIN = { userId: "00000000-0000-4000-8000-000000000001", role: "administrator" };
const ATTACHE = { userId: "00000000-0000-4000-8000-000000000002", role: "attache" };
const PEOPLE: Record<string, { userId: string; role: string }> = { administrator: ADMIN, attache: ATTACHE };

const authenticate: Authenticator = (request) => {
  const who = request.headers["x-test-role"];
  return Promise.resolve(typeof who === "string" ? (PEOPLE[who] ?? null) : null);
};

const staffRoutes: FastifyPluginAsyncZod = async (app) => {
  app.patch(
    "/staff/:id/deactivate",
    {
      config: { access: ["administrator"], audit: { action: "staff.deactivate", objectType: "staff_member" } },
      schema: { params: z.object({ id: z.uuid() }), response: { 200: z.object({ active: z.boolean() }) } },
    },
    (request) =>
      request.transaction(async (database, audit) => {
        await database.query("update platform.users set active = false where id = $1", [request.params.id]);
        audit.object(request.params.id, { reason_code: "left_ministry" });
        return { active: false };
      }),
  );
  app.patch(
    "/staff/:id/deactivate-then-fail",
    {
      config: { access: ["administrator"], audit: { action: "staff.deactivate", objectType: "staff_member" } },
      schema: { params: z.object({ id: z.uuid() }) },
    },
    (request) =>
      request.transaction(async (database) => {
        await database.query("update platform.users set active = false where id = $1", [request.params.id]);
        throw new Error("stopped after the change");
      }),
  );
  app.get(
    "/staff/:id",
    {
      config: { access: ["administrator"], audit: { action: "staff_member.read", objectType: "staff_member" } },
      schema: { params: z.object({ id: z.uuid() }), response: { 200: z.object({ displayName: z.string() }) } },
    },
    (request) =>
      request.transaction(async (database, audit) => {
        const result = await database.query<{ display_name: string }>("select display_name from platform.users where id = $1", [
          request.params.id,
        ]);
        audit.object(request.params.id);
        return { displayName: result.rows[0]?.display_name ?? "" };
      }),
  );
};

let testDatabase: TestDatabase | undefined;
let database: Database | undefined;
let app: App | undefined;

before(async () => {
  testDatabase = await openTestDatabase();
  if (testDatabase === undefined) {
    process.stderr.write(`# audit database tests skipped: ${SKIP_MESSAGE}\n`);
    return;
  }
  await recreateDatabase(testDatabase.connection);
  await migrate(testDatabase.connection, REPOSITORY, "core-api");
  await seed(testDatabase.connection, REPOSITORY, "core-api");
  const { endpoint } = testDatabase;
  const config = loadConfig(
    { SMS_ENV: "test", DATABASE_HOST: endpoint.host, DATABASE_PORT: String(endpoint.port), DATABASE_NAME: endpoint.database },
    () => "",
  );
  const logger = createLogger({ level: "silent", service: "core-api", version: "t" });
  database = createDatabase(config.database, logger);
  app = await createApp({
    config: { version: "t", server: { host: "127.0.0.1", port: 0, trustProxy: false } },
    logger,
    database,
    authenticate,
    modules: [() => staffRoutes],
  });
});

after(async () => {
  await app?.close();
  await database?.close();
  await testDatabase?.close();
});

const check = (name: string, body: (app: App, database: Database) => Promise<void>): void => {
  test(name, async (context) => {
    if (app === undefined || database === undefined) context.skip(SKIP_MESSAGE);
    else await body(app, database);
  });
};

interface Entry {
  actor_id: string;
  actor_role: string;
  action: string;
  object_type: string;
  object_id: string | null;
  detail: Record<string, unknown>;
}
const readLog = async (db: Database, action: string): Promise<Entry[]> =>
  (
    await db.asUser(ADMIN, (q) =>
      q.query<Entry>(
        "select actor_id, actor_role, action, object_type, object_id, detail from platform.audit_log where action = $1 order by id",
        [action],
      ),
    )
  ).rows;
const isActive = async (db: Database, id: string): Promise<boolean> =>
  (await db.asUser(ADMIN, (q) => q.query<{ active: boolean }>("select active from platform.users where id = $1", [id]))).rows[0]?.active ??
  false;

describe("the audit hooks, against a real PostgreSQL", () => {
  check("a change and its entry are committed together, in the name of the administrator", async (app, db) => {
    const response = await app.inject({
      method: "PATCH",
      url: `/api/staff/${ATTACHE.userId}/deactivate`,
      headers: { "x-test-role": "administrator" },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(await isActive(db, ATTACHE.userId), false);
    const [entry, ...others] = await readLog(db, "staff.deactivate");
    assert.equal(others.length, 0);
    assert.equal(entry?.actor_id, ADMIN.userId);
    assert.equal(entry?.actor_role, "administrator");
    assert.equal(entry?.object_type, "staff_member");
    assert.equal(entry?.object_id, ATTACHE.userId);
    assert.deepEqual(entry?.detail, { reason_code: "left_ministry" });
    await db.asUser(ADMIN, (q) => q.query("update platform.users set active = true where id = $1", [ATTACHE.userId]));
  });

  check("when the work fails after a change, the change and the entry are both gone", async (app, db) => {
    const before = (await readLog(db, "staff.deactivate")).length;
    const response = await app.inject({
      method: "PATCH",
      url: `/api/staff/${ATTACHE.userId}/deactivate-then-fail`,
      headers: { "x-test-role": "administrator" },
    });
    assert.equal(response.statusCode, 500);
    assert.equal(await isActive(db, ATTACHE.userId), true);
    assert.equal((await readLog(db, "staff.deactivate")).length, before);
  });

  check("a read of a record leaves an entry with the identifier and nothing else about the record", async (app, db) => {
    const response = await app.inject({ method: "GET", url: `/api/staff/${ATTACHE.userId}`, headers: { "x-test-role": "administrator" } });
    assert.equal(response.statusCode, 200);
    const entries = await readLog(db, "staff_member.read");
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.object_id, ATTACHE.userId);
    assert.doesNotMatch(JSON.stringify(entries), new RegExp(response.json<{ displayName: string }>().displayName));
  });

  check("a refused attempt is recorded in the name of the person who made it, and only an administrator can read it", async (app, db) => {
    const response = await app.inject({
      method: "PATCH",
      url: `/api/staff/${ADMIN.userId}/deactivate`,
      headers: { "x-test-role": "attache" },
    });
    assert.equal(response.statusCode, 403);
    assert.equal(await isActive(db, ADMIN.userId), true);
    const entries = await readLog(db, "access.denied");
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.actor_id, ATTACHE.userId);
    assert.equal(entries[0]?.actor_role, "attache");
    assert.equal(entries[0]?.object_id, "PATCH /api/staff/:id/deactivate");
    assert.deepEqual(entries[0]?.detail, { allowed_roles: "administrator", attempted_action: "staff.deactivate" });
    // The person who was refused cannot read the log, so they cannot see or tamper with the record of it.
    const asAttache = await db.asUser(ATTACHE, (q) => q.query("select id from platform.audit_log"));
    assert.equal(asAttache.rowCount, 0);
  });

  check("the log of these requests cannot be altered afterwards, even through the application's own connection", async (_app, db) => {
    await assert.rejects(
      db.asUser(ADMIN, (q) => q.query("update platform.audit_log set action = 'edited'")),
      /append-only|permission denied|row-level/,
    );
    await assert.rejects(
      db.asUser(ADMIN, (q) => q.query("delete from platform.audit_log")),
      /append-only|permission denied|row-level/,
    );
  });
});
