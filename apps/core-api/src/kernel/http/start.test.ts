import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { migrate, recreateDatabase, seed } from "../../../../../tools/db/migrate.ts";
import { openTestDatabase, SKIP_MESSAGE, type TestDatabase } from "../../../../../tools/db/test-database.ts";
import { loadConfig } from "../config/load.ts";
import { createLogger } from "../logging/logger.ts";
import { startApplication, type RunningApplication } from "./start.ts";

/** The application as a whole: a real server on a real port, talking to a real PostgreSQL. */

const REPOSITORY = join(import.meta.dirname, "..", "..", "..", "..", "..");
const logger = createLogger({ level: "silent", service: "core-api", version: "test" });

let testDatabase: TestDatabase | undefined;
before(async () => {
  testDatabase = await openTestDatabase();
  if (testDatabase === undefined) {
    process.stderr.write(`# application start tests skipped: ${SKIP_MESSAGE}\n`);
    return;
  }
  await recreateDatabase(testDatabase.connection);
  await migrate(testDatabase.connection, REPOSITORY, "core-api");
  await seed(testDatabase.connection, REPOSITORY, "core-api");
});
after(async () => testDatabase?.close());

function configFor(database: { host: string; port: number; name: string }) {
  return loadConfig(
    {
      SMS_ENV: "test",
      PORT: "5999",
      APP_VERSION: "abc123",
      DATABASE_HOST: database.host,
      DATABASE_PORT: String(database.port),
      DATABASE_NAME: database.name,
    },
    () => "",
  );
}

async function running(
  config: ReturnType<typeof configFor>,
  work: (application: RunningApplication, base: string) => Promise<void>,
): Promise<void> {
  // Port 0 asks the system for a free port, so tests never clash with each other or with a running application.
  const application = await startApplication({ ...config, server: { ...config.server, port: 0 } }, logger);
  try {
    await work(application, `http://127.0.0.1:${application.port}`);
  } finally {
    await application.stop();
  }
}

describe("the application, started for real", () => {
  test("answers /health and, with the database up, /ready", async (context) => {
    if (testDatabase === undefined) return context.skip(SKIP_MESSAGE);
    const { endpoint } = testDatabase;
    await running(configFor({ host: endpoint.host, port: endpoint.port, name: endpoint.database }), async (application, base) => {
      assert.ok(application.port > 0);
      const health = await fetch(`${base}/health`);
      assert.equal(health.status, 200);
      assert.deepEqual(await health.json(), { status: "ok", service: "core-api", version: "abc123" });
      const ready = await fetch(`${base}/ready`);
      assert.equal(ready.status, 200);
      assert.deepEqual(await ready.json(), { status: "ready" });
    });
  });

  test("with the database down it still runs (/health) and says it is not ready (/ready)", async () => {
    await running(configFor({ host: "127.0.0.1", port: 1, name: "sms" }), async (_application, base) => {
      assert.equal((await fetch(`${base}/health`)).status, 200);
      const ready = await fetch(`${base}/ready`);
      assert.equal(ready.status, 503);
      assert.equal(((await ready.json()) as { code: string }).code, "unavailable");
    });
  });

  test("an address that no route serves is a 404 problem", async () => {
    await running(configFor({ host: "127.0.0.1", port: 1, name: "sms" }), async (_application, base) => {
      const response = await fetch(`${base}/api/anything`);
      assert.equal(response.status, 404);
      assert.equal(response.headers.get("content-type")?.startsWith("application/problem+json"), true);
    });
  });

  test("stopping closes the port", async () => {
    const config = configFor({ host: "127.0.0.1", port: 1, name: "sms" });
    const application = await startApplication({ ...config, server: { ...config.server, port: 0 } }, logger);
    const base = `http://127.0.0.1:${application.port}`;
    assert.equal((await fetch(`${base}/health`)).status, 200);
    await application.stop();
    await assert.rejects(fetch(`${base}/health`));
  });

  test("a port that is already taken stops the start with an error and leaves nothing open", async () => {
    const config = configFor({ host: "127.0.0.1", port: 1, name: "sms" });
    const first = await startApplication({ ...config, server: { ...config.server, port: 0 } }, logger);
    try {
      await assert.rejects(startApplication({ ...config, server: { ...config.server, port: first.port } }, logger), /EADDRINUSE/);
    } finally {
      await first.stop();
    }
  });
});
