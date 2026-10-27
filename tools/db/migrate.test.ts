import assert from "node:assert/strict";
import { after, afterEach, before, describe, test } from "node:test";
import { join } from "node:path";
import { configFromEnvironment } from "./cli.ts";
import { explain, literal } from "./connection.ts";
import { assertSyntheticEnvironment, migrate, plan, readApplied, recreateDatabase, seed, status, type Applied } from "./migrate.ts";
import { checksum, describeSqlFile, findSqlFiles, loadSqlFiles, type LoadedSql } from "./sql-files.ts";
import { openTestDatabase, SKIP_MESSAGE, type TestDatabase } from "./test-database.ts";
import { createProject, type Project } from "../test-support/project.ts";

const REPOSITORY = join(import.meta.dirname, "..", "..");
const KERNEL = "apps/core-api/src/kernel/db/migrations";
const MODULE = (name: string): string => `apps/core-api/src/modules/${name}/internal/infrastructure/migrations`;

const loaded = (scope: string, name: string, sql: string): LoadedSql => ({ app: "core-api", scope, kind: "migration", file: `${scope}/${name}`, name, sql, checksum: checksum(sql) });

describe("finding SQL files", () => {
  test("describes where a file belongs", () => {
    assert.deepEqual(describeSqlFile(`${KERNEL}/0001_a.sql`), { app: "core-api", scope: "platform", kind: "migration", file: `${KERNEL}/0001_a.sql`, name: "0001_a.sql" });
    assert.equal(describeSqlFile("apps/core-api/src/kernel/db/seeds/0001_a.sql")?.kind, "seed");
    assert.equal(describeSqlFile(`${MODULE("registry")}/0001_a.sql`)?.scope, "registry");
    assert.equal(describeSqlFile("apps/core-api/src/modules/registry/internal/domain/x.sql"), undefined);
    assert.equal(describeSqlFile("docs/0001_a.sql"), undefined);
  });

  let project: Project | undefined;
  afterEach(() => {
    project?.cleanup();
    project = undefined;
  });

  test("platform comes first, then modules by name, then by number", () => {
    project = createProject({
      [`${MODULE("registry")}/0002_b.sql`]: "select 2;",
      [`${MODULE("registry")}/0001_a.sql`]: "select 1;",
      [`${MODULE("access")}/0001_a.sql`]: "select 1;",
      [`${KERNEL}/0002_b.sql`]: "select 2;",
      [`${KERNEL}/0001_a.sql`]: "select 1;",
    });
    const order = findSqlFiles(project.root, "migration").map((item) => `${item.scope}/${item.name}`);
    assert.deepEqual(order, ["platform/0001_a.sql", "platform/0002_b.sql", "access/0001_a.sql", "registry/0001_a.sql", "registry/0002_b.sql"]);
  });

  test("a badly named migration is refused when loading", () => {
    project = createProject({ [`${KERNEL}/1_bad.sql`]: "select 1;" });
    assert.throws(() => loadSqlFiles(project?.root ?? "", "migration", "core-api"), /four digits/);
  });

  test("the checksum ignores line endings", () => {
    assert.equal(checksum("a\r\nb\r\n"), checksum("a\nb\n"));
    assert.notEqual(checksum("a"), checksum("b"));
  });
});

describe("planning", () => {
  const a = loaded("platform", "0001_a.sql", "select 1;");
  const b = loaded("platform", "0002_b.sql", "select 2;");
  const applied = (item: LoadedSql, sum = item.checksum): Applied => ({ scope: item.scope, name: item.name, checksum: sum });

  test("everything is pending on an empty database", () => {
    assert.deepEqual(plan([a, b], []).pending, [a, b]);
  });
  test("only the new ones are pending", () => {
    const result = plan([a, b], [applied(a)]);
    assert.deepEqual(result.pending, [b]);
    assert.deepEqual(result.changed, []);
    assert.deepEqual(result.missing, []);
  });
  test("an edited migration is reported", () => {
    assert.deepEqual(plan([a], [applied(a, "other")]).changed, [a]);
  });
  test("a recorded migration without a file is reported", () => {
    assert.deepEqual(plan([], [applied(a)]).missing, [applied(a)]);
  });
  test("the same file name in two modules is two migrations", () => {
    const other = loaded("registry", "0001_a.sql", "select 3;");
    assert.deepEqual(plan([a, other], [applied(a)]).pending, [other]);
  });
});

describe("environments and settings", () => {
  test("seeding and resetting are refused outside synthetic environments", () => {
    assert.doesNotThrow(() => assertSyntheticEnvironment({}, "seed"));
    assert.doesNotThrow(() => assertSyntheticEnvironment({ SMS_ENV: "staging" }, "seed"));
    assert.throws(() => assertSyntheticEnvironment({ SMS_ENV: "production" }, "seed"), /Refusing to seed/);
    assert.throws(() => assertSyntheticEnvironment({ SMS_ENV: "prod" }, "reset"), /Refusing/);
  });
  test("defaults point at the local container", () => {
    assert.deepEqual(configFromEnvironment({}), { mode: "docker", user: "sms", database: "sms" });
    assert.equal(configFromEnvironment({ SMS_DB_MODE: "host", PGDATABASE: "x" }).database, "x");
    assert.throws(() => configFromEnvironment({ SMS_DB_MODE: "carrier-pigeon" }), /Unknown mode/);
  });
  test("a stopped Docker or database gets an explanation that says what to do", () => {
    assert.match(explain("docker", 1, "failed to connect to the docker API at unix:///var/run/docker.sock"), /Docker is not running/);
    assert.match(explain("docker", 1, 'service "postgres" is not running'), /npm run db:up/);
    assert.match(explain("host", 3, "psql: ERROR:  boom\nmore"), /exit code 3\): psql: ERROR:  boom/);
    assert.doesNotMatch(explain("host", 1, "docker.sock"), /Docker is not running/);
  });
  test("literals are quoted", () => {
    assert.equal(literal("it's"), "'it''s'");
  });
});

let database: TestDatabase | undefined;
before(() => {
  database = openTestDatabase();
  if (database === undefined) process.stderr.write(`# database tests skipped: ${SKIP_MESSAGE}\n`);
});
after(() => database?.close());

describe("against a real PostgreSQL", { skip: false }, () => {
  const need = (): TestDatabase => {
    if (database === undefined) throw new Error("skipped");
    return database;
  };
  const guard = (name: string, body: (db: TestDatabase) => void): void => {
    test(name, (context) => {
      if (database === undefined) {
        context.skip(SKIP_MESSAGE);
        return;
      }
      recreateDatabase(need().connection);
      body(need());
    });
  };

  guard("applies the real migrations, then does nothing the second time", ({ connection }) => {
    const first = migrate(connection, REPOSITORY, "core-api");
    assert.deepEqual(first.applied, ["platform/0001_platform_schema.sql", "platform/0002_users.sql", "platform/0003_audit_log.sql"]);
    const second = migrate(connection, REPOSITORY, "core-api");
    assert.deepEqual(second.applied, []);
    assert.equal(second.alreadyApplied, 3);
    const state = status(connection, REPOSITORY, "core-api");
    assert.equal(state.applied.length, 3);
    assert.equal(state.plan.pending.length, 0);
  });

  guard("records a checksum for each migration", ({ connection }) => {
    migrate(connection, REPOSITORY, "core-api");
    const recorded = readApplied(connection);
    const expected = loadSqlFiles(REPOSITORY, "migration", "core-api").map((item) => item.checksum);
    assert.deepEqual(recorded.map((item) => item.checksum), expected);
  });

  describe("with a fixture project", () => {
    let project: Project | undefined;
    afterEach(() => {
      project?.cleanup();
      project = undefined;
    });

    guard("refuses a migration that was edited after it was applied", ({ connection }) => {
      project = createProject({ [`${KERNEL}/0001_a.sql`]: "create schema if not exists platform;\ncreate table platform.t (a int);" });
      migrate(connection, project.root, "core-api");
      project.write(`${KERNEL}/0001_a.sql`, "create schema if not exists platform;\ncreate table platform.t (a int, b int);");
      assert.throws(() => migrate(connection, project?.root ?? "", "core-api"), /was edited/);
    });

    guard("refuses a database that knows migrations the files do not", ({ connection }) => {
      project = createProject({ [`${KERNEL}/0001_a.sql`]: "create schema if not exists platform;", [`${KERNEL}/0002_b.sql`]: "select 1;" });
      migrate(connection, project.root, "core-api");
      project.remove(`${KERNEL}/0002_b.sql`);
      assert.throws(() => migrate(connection, project?.root ?? "", "core-api"), /no file explains/);
    });

    guard("a failing migration leaves nothing behind and is not recorded", ({ connection }) => {
      project = createProject({
        [`${KERNEL}/0001_a.sql`]: "create schema if not exists platform;\ncreate table platform.good (a int);",
        [`${KERNEL}/0002_b.sql`]: "create table platform.half (a int);\nselect 1/0;",
      });
      assert.throws(() => migrate(connection, project?.root ?? "", "core-api"), /refused the script/);
      assert.equal(connection.run("select to_regclass('platform.half') is null;").trim(), "t");
      assert.equal(connection.run("select to_regclass('platform.good') is not null;").trim(), "t");
      assert.deepEqual(readApplied(connection).map((item) => item.name), ["0001_a.sql"]);
    });

    guard("migrations of modules run after the platform and in order", ({ connection }) => {
      project = createProject({
        [`${KERNEL}/0001_a.sql`]: "create schema if not exists platform;",
        [`${MODULE("registry")}/0001_a.sql`]: "create schema registry;\ncreate table registry.t (a int);",
        [`${MODULE("registry")}/0002_b.sql`]: "alter table registry.t add column b int;",
      });
      const result = migrate(connection, project.root, "core-api");
      assert.deepEqual(result.applied, ["platform/0001_a.sql", "registry/0001_a.sql", "registry/0002_b.sql"]);
      assert.equal(connection.run("select count(*) from information_schema.columns where table_schema = 'registry';").trim(), "2");
    });

    guard("seeds run in order and can be run again", ({ connection }) => {
      project = createProject({
        [`${KERNEL}/0001_a.sql`]: "create schema if not exists platform;\ncreate table platform.t (id int primary key);",
        "apps/core-api/src/kernel/db/seeds/0001_rows.sql": "insert into platform.t values (1), (2) on conflict do nothing;",
      });
      migrate(connection, project.root, "core-api");
      assert.deepEqual(seed(connection, project.root, "core-api"), ["platform/0001_rows.sql"]);
      seed(connection, project.root, "core-api");
      assert.equal(connection.run("select count(*) from platform.t;").trim(), "2");
    });
  });

  guard("the real seed adds four staff members once", ({ connection }) => {
    migrate(connection, REPOSITORY, "core-api");
    seed(connection, REPOSITORY, "core-api");
    seed(connection, REPOSITORY, "core-api");
    assert.equal(connection.run("select count(*) from platform.users;").trim(), "4");
    assert.equal(connection.run("select count(*) from platform.users where email not like '%@example.invalid';").trim(), "0");
  });

  guard("recreating the database really empties it", ({ connection }) => {
    migrate(connection, REPOSITORY, "core-api");
    recreateDatabase(connection);
    assert.equal(connection.run("select count(*) from pg_namespace where nspname = 'platform';").trim(), "0");
  });

  test("an unsafe database name is refused", () => {
    assert.throws(() => recreateDatabase({ config: { mode: "host", user: "x", database: "a; drop database b" }, run: () => "" }), /not a safe database name/);
  });
});
