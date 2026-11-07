import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { migrate, recreateDatabase, seed } from "../../../../../tools/db/migrate.ts";
import { openTestDatabase, SKIP_MESSAGE, type TestDatabase } from "../../../../../tools/db/test-database.ts";
import { loadConfig } from "../config/load.ts";
import { createLogger } from "../logging/logger.ts";
import { createDatabase, type Database } from "./database.ts";

const REPOSITORY = join(import.meta.dirname, "..", "..", "..", "..", "..");
const ADMIN = { userId: "00000000-0000-4000-8000-000000000001", role: "administrator" };
const ATTACHE = { userId: "00000000-0000-4000-8000-000000000002", role: "attache" };

let testDatabase: TestDatabase | undefined;
let database: Database | undefined;
const logLines: string[] = [];

before(async () => {
  testDatabase = await openTestDatabase();
  if (testDatabase === undefined) {
    process.stderr.write(`# database adapter tests skipped: ${SKIP_MESSAGE}\n`);
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
  database = createDatabase(
    config.database,
    createLogger({ level: "debug", service: "core-api", version: "t" }, { write: (line: string) => void logLines.push(line) }),
  );
});

after(async () => {
  await database?.close();
  await testDatabase?.close();
});

const check = (name: string, body: (database: Database) => Promise<void>): void => {
  test(name, async (context) => {
    if (database === undefined) context.skip(SKIP_MESSAGE);
    else await body(database);
  });
};

describe("the database adapter, against a real PostgreSQL, as the application role", () => {
  check("an administrator sees every staff member, an attache sees only themselves", async (db) => {
    const all = await db.asUser(ADMIN, (q) => q.query<{ id: string }>("select id from platform.users"));
    const own = await db.asUser(ATTACHE, (q) => q.query<{ id: string }>("select id from platform.users"));
    assert.equal(all.rows.length, 4);
    assert.deepEqual(
      own.rows.map((row) => row.id),
      [ATTACHE.userId],
    );
  });

  check("without an identity nothing is visible", async (db) => {
    const result = await db.withoutIdentity((q) => q.query("select id from platform.users"));
    assert.equal(result.rowCount, 0);
  });

  check("the identity does not leak to the next use of the same connection", async (db) => {
    // One connection at a time would be enough to expose a leak, so run many in turn.
    for (let round = 0; round < 12; round += 1) {
      await db.asUser(ADMIN, (q) => q.query("select 1"));
      const after = await db.withoutIdentity((q) => q.query("select id from platform.users"));
      assert.equal(after.rowCount, 0);
    }
  });

  check("a failure rolls the work back and is passed on", async (db) => {
    await assert.rejects(
      db.asUser(ADMIN, async (q) => {
        await q.query(
          "insert into platform.audit_log (actor_id, actor_role, action, object_type) values ($1, $2, 'test.rollback', 'test')",
          [ADMIN.userId, ADMIN.role],
        );
        throw new Error("stop");
      }),
      /stop/,
    );
    const rows = await db.asUser(ADMIN, (q) => q.query("select 1 from platform.audit_log where action = 'test.rollback'"));
    assert.equal(rows.rowCount, 0);
  });

  check("work that succeeds is committed", async (db) => {
    await db.asUser(ADMIN, (q) =>
      q.query("insert into platform.audit_log (actor_id, actor_role, action, object_type) values ($1, $2, 'test.commit', 'test')", [
        ADMIN.userId,
        ADMIN.role,
      ]),
    );
    const rows = await db.asUser(ADMIN, (q) => q.query("select 1 from platform.audit_log where action = 'test.commit'"));
    assert.equal(rows.rowCount, 1);
  });

  check("values are sent as parameters", async (db) => {
    const hostile = "x'; drop table platform.users; --";
    const result = await db.asUser(ADMIN, (q) => q.query<{ echoed: string }>("select $1::text as echoed", [hostile]));
    assert.equal(result.rows[0]?.echoed, hostile);
    assert.equal((await db.asUser(ADMIN, (q) => q.query("select 1 from platform.users"))).rowCount, 4);
  });

  check("an invalid identity never reaches the database", async (db) => {
    await assert.rejects(
      db.asUser({ userId: "not-a-uuid", role: "administrator" }, (q) => q.query("select 1")),
      /lowercase UUID/,
    );
  });

  check("is reachable", async (db) => {
    assert.equal(await db.isReachable(), true);
  });

  check("more requests than connections all complete", async (db) => {
    const results = await Promise.all(Array.from({ length: 40 }, () => db.asUser(ADMIN, (q) => q.query("select pg_sleep(0.01)"))));
    assert.equal(results.length, 40);
  });
});

describe("the database adapter when the server cannot be reached", () => {
  test("reports not reachable, quickly, without throwing", async () => {
    const config = loadConfig({ SMS_ENV: "test", DATABASE_HOST: "127.0.0.1", DATABASE_PORT: "1" }, () => "");
    const lost = createDatabase(config.database, createLogger({ level: "silent", service: "s", version: "v" }));
    const started = Date.now();
    assert.equal(await lost.isReachable(1_500), false);
    assert.ok(Date.now() - started < 4_000);
    await lost.close();
  });
});

describe("a connection that dies in the middle of the work", () => {
  check("does not end the program, and the next requests are served", async (db) => {
    // Without a listener on the connection this would be an uncaught error, which ends the program.
    await assert.rejects(db.asUser(ADMIN, (q) => q.query("select pg_terminate_backend(pg_backend_pid())")));
    for (let round = 0; round < 15; round += 1) {
      const result = await db.asUser(ADMIN, (q) => q.query<{ one: number }>("select 1 as one"));
      assert.equal(result.rowCount, 1);
    }
  });
});
