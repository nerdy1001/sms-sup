import assert from "node:assert/strict";
import { after, afterEach, before, describe, test } from "node:test";
import { join } from "node:path";
import { main } from "./cli.ts";
import { configFromEnvironment, explain, literal, SqlError, type Connection } from "./connection.ts";
import {
  assertSyntheticEnvironment,
  migrate,
  plan,
  readApplied,
  recreateDatabase,
  seed,
  setApplicationPassword,
  status,
  type Applied,
} from "./migrate.ts";
import { checksum, describeSqlFile, findSqlFiles, loadSqlFiles, type LoadedSql } from "./sql-files.ts";
import { openTestDatabase, SKIP_MESSAGE, type TestDatabase } from "./test-database.ts";
import { createProject, type Project } from "../test-support/project.ts";

const REPOSITORY = join(import.meta.dirname, "..", "..");
const KERNEL = "apps/core-api/src/kernel/db/migrations";
const MODULE = (name: string): string => `apps/core-api/src/modules/${name}/internal/infrastructure/migrations`;

const loaded = (scope: string, name: string, sql: string): LoadedSql => ({
  app: "core-api",
  scope,
  kind: "migration",
  file: `${scope}/${name}`,
  name,
  sql,
  checksum: checksum(sql),
});

describe("finding SQL files", () => {
  test("describes where a file belongs", () => {
    assert.deepEqual(describeSqlFile(`${KERNEL}/0001_a.sql`), {
      app: "core-api",
      scope: "platform",
      kind: "migration",
      file: `${KERNEL}/0001_a.sql`,
      name: "0001_a.sql",
    });
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
    assert.deepEqual(order, [
      "platform/0001_a.sql",
      "platform/0002_b.sql",
      "access/0001_a.sql",
      "registry/0001_a.sql",
      "registry/0002_b.sql",
    ]);
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
    const config = configFromEnvironment({});
    assert.deepEqual({ ...config }, { host: "127.0.0.1", port: 5432, user: "sms", database: "sms", password: undefined });
    assert.equal(configFromEnvironment({ PGDATABASE: "x", PGHOST: "postgres", PGPORT: "6543" }).database, "x");
    assert.equal(configFromEnvironment({ PGPORT: "6543" }).port, 6543);
    assert.throws(() => configFromEnvironment({ PGPORT: "carrier-pigeon" }), /not a port number/);
  });
  test("the password can come from a file, but not from both a file and a variable", () => {
    assert.equal(configFromEnvironment({ PGPASSWORD_FILE: "/run/secrets/x" }, () => "s3cret\n").password, "s3cret");
    assert.equal(configFromEnvironment({ PGPASSWORD: "plain" }).password, "plain");
    assert.throws(() => configFromEnvironment({ PGPASSWORD: "a", PGPASSWORD_FILE: "/x" }, () => "b"), /not both/);
    assert.throws(
      () =>
        configFromEnvironment({ PGPASSWORD_FILE: "/missing" }, () => {
          throw new Error("ENOENT");
        }),
      /cannot be read/,
    );
  });
  test("a database that is not there gets an explanation that says what to do", () => {
    const config = configFromEnvironment({});
    assert.match(
      explain(config, Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" })),
      /npm run db:up/,
    );
    assert.match(explain({ ...config, host: "db" }, Object.assign(new Error("x"), { code: "ENOTFOUND" })), /"db" cannot be found/);
    assert.match(
      explain(config, Object.assign(new Error("password authentication failed"), { code: "28P01" })),
      /refused the login for user "sms"/,
    );
    assert.match(explain(config, Object.assign(new Error("database does not exist"), { code: "3D000" })), /db:reset/);
    assert.match(explain({ ...config, host: "/tmp/sock" }, Object.assign(new Error("x"), { code: "ENOENT" })), /socket in \/tmp\/sock/);
  });
  test("literals are quoted", () => {
    assert.equal(literal("it's"), "'it''s'");
  });
});

let database: TestDatabase | undefined;
before(async () => {
  database = await openTestDatabase();
  if (database === undefined) process.stderr.write(`# database tests skipped: ${SKIP_MESSAGE}\n`);
});
after(async () => database?.close());

describe("against a real PostgreSQL", { skip: false }, () => {
  const need = (): TestDatabase => {
    if (database === undefined) throw new Error("skipped");
    return database;
  };
  const guard = (name: string, body: (db: TestDatabase) => Promise<void>): void => {
    test(name, async (context) => {
      if (database === undefined) {
        context.skip(SKIP_MESSAGE);
        return;
      }
      await recreateDatabase(need().connection);
      await body(need());
    });
  };

  guard("applies the real migrations, then does nothing the second time", async ({ connection }) => {
    const first = await migrate(connection, REPOSITORY, "core-api");
    assert.deepEqual(first.applied, ["platform/0001_platform_schema.sql", "platform/0002_users.sql", "platform/0003_audit_log.sql"]);
    const second = await migrate(connection, REPOSITORY, "core-api");
    assert.deepEqual(second.applied, []);
    assert.equal(second.alreadyApplied, 3);
    const state = await status(connection, REPOSITORY, "core-api");
    assert.equal(state.applied.length, 3);
    assert.equal(state.plan.pending.length, 0);
  });

  guard("records a checksum for each migration", async ({ connection }) => {
    await migrate(connection, REPOSITORY, "core-api");
    const recorded = await readApplied(connection);
    const expected = loadSqlFiles(REPOSITORY, "migration", "core-api").map((item) => item.checksum);
    assert.deepEqual(
      recorded.map((item) => item.checksum),
      expected,
    );
  });

  describe("with a fixture project", () => {
    let project: Project | undefined;
    afterEach(() => {
      project?.cleanup();
      project = undefined;
    });

    guard("refuses a migration that was edited after it was applied", async ({ connection }) => {
      project = createProject({ [`${KERNEL}/0001_a.sql`]: "create schema if not exists platform;\ncreate table platform.t (a int);" });
      await migrate(connection, project.root, "core-api");
      project.write(`${KERNEL}/0001_a.sql`, "create schema if not exists platform;\ncreate table platform.t (a int, b int);");
      await assert.rejects(() => migrate(connection, project?.root ?? "", "core-api"), /was edited/);
    });

    guard("refuses a database that knows migrations the files do not", async ({ connection }) => {
      project = createProject({ [`${KERNEL}/0001_a.sql`]: "create schema if not exists platform;", [`${KERNEL}/0002_b.sql`]: "select 1;" });
      await migrate(connection, project.root, "core-api");
      project.remove(`${KERNEL}/0002_b.sql`);
      await assert.rejects(() => migrate(connection, project?.root ?? "", "core-api"), /no file explains/);
    });

    guard("a failing migration leaves nothing behind and is not recorded", async ({ connection }) => {
      project = createProject({
        [`${KERNEL}/0001_a.sql`]: "create schema if not exists platform;\ncreate table platform.good (a int);",
        [`${KERNEL}/0002_b.sql`]: "create table platform.half (a int);\nselect 1/0;",
      });
      await assert.rejects(() => migrate(connection, project?.root ?? "", "core-api"), /refused the script/);
      assert.equal((await connection.run("select to_regclass('platform.half') is null;")).trim(), "t");
      assert.equal((await connection.run("select to_regclass('platform.good') is not null;")).trim(), "t");
      assert.deepEqual(
        (await readApplied(connection)).map((item) => item.name),
        ["0001_a.sql"],
      );
    });

    guard("migrations of modules run after the platform and in order", async ({ connection }) => {
      project = createProject({
        [`${KERNEL}/0001_a.sql`]: "create schema if not exists platform;",
        [`${MODULE("registry")}/0001_a.sql`]: "create schema registry;\ncreate table registry.t (a int);",
        [`${MODULE("registry")}/0002_b.sql`]: "alter table registry.t add column b int;",
      });
      const result = await migrate(connection, project.root, "core-api");
      assert.deepEqual(result.applied, ["platform/0001_a.sql", "registry/0001_a.sql", "registry/0002_b.sql"]);
      assert.equal((await connection.run("select count(*) from information_schema.columns where table_schema = 'registry';")).trim(), "2");
    });

    guard("seeds run in order and can be run again", async ({ connection }) => {
      project = createProject({
        [`${KERNEL}/0001_a.sql`]: "create schema if not exists platform;\ncreate table platform.t (id int primary key);",
        "apps/core-api/src/kernel/db/seeds/0001_rows.sql": "insert into platform.t values (1), (2) on conflict do nothing;",
      });
      await migrate(connection, project.root, "core-api");
      assert.deepEqual(await seed(connection, project.root, "core-api"), ["platform/0001_rows.sql"]);
      await seed(connection, project.root, "core-api");
      assert.equal((await connection.run("select count(*) from platform.t;")).trim(), "2");
    });
  });

  guard("the real seed adds four staff members once", async ({ connection }) => {
    await migrate(connection, REPOSITORY, "core-api");
    await seed(connection, REPOSITORY, "core-api");
    await seed(connection, REPOSITORY, "core-api");
    assert.equal((await connection.run("select count(*) from platform.users;")).trim(), "4");
    assert.equal((await connection.run("select count(*) from platform.users where email not like '%@example.invalid';")).trim(), "0");
  });

  guard("recreating the database really empties it", async ({ connection }) => {
    await migrate(connection, REPOSITORY, "core-api");
    await recreateDatabase(connection);
    assert.equal((await connection.run("select count(*) from pg_namespace where nspname = 'platform';")).trim(), "0");
  });

  guard("gives the application role a password, quoting it safely", async ({ connection }) => {
    await migrate(connection, REPOSITORY, "core-api");
    // A role belongs to the whole server, not to the database that was just recreated, so on a server that
    // is used for other things it may already have a password from an earlier run. Start from none, and
    // leave the role as it was found.
    await connection.run("alter role sms_app password null;");
    try {
      const before = await connection.run("select rolpassword is null from pg_authid where rolname = 'sms_app';");
      assert.equal(before.trim(), "t");
      // A quote and a backslash would break a statement built by hand; the password is quoted by PostgreSQL.
      await setApplicationPassword(connection, "pa'ss\\word\"with;odd-chars-1234567890");
      const after = await connection.run("select rolpassword like 'SCRAM-SHA-256$%' from pg_authid where rolname = 'sms_app';");
      assert.equal(after.trim(), "t");
      // Still the same restricted role: it can log in, and it is still not a superuser.
      assert.equal((await connection.run("select rolcanlogin and not rolsuper from pg_roles where rolname = 'sms_app';")).trim(), "t");
    } finally {
      await connection.run("alter role sms_app password null;");
    }
  });

  guard("refuses a short password", async ({ connection }) => {
    await migrate(connection, REPOSITORY, "core-api");
    await assert.rejects(() => setApplicationPassword(connection, "short"), /too short/);
  });

  test("refuses to set a password when the role does not exist", async () => {
    // Roles belong to the whole server, so a real one cannot be removed without disturbing other tests.
    const noRows = (): Promise<string[][]> => Promise.resolve([]);
    const fake: Connection = {
      config: { host: "h", port: 1, user: "x", database: "d" },
      run: () => Promise.reject(new Error("must not run")),
      query: noRows,
    };
    await assert.rejects(() => setApplicationPassword(fake, "x".repeat(30)), /does not exist/);
  });

  guard("the command line migrates, reports and provisions", async (db) => {
    const { host, port, database } = db.endpoint;
    const env = { PGHOST: host, PGPORT: String(port), PGDATABASE: database, PGUSER: db.connection.config.user, SMS_ENV: "test" };
    const lines: string[] = [];
    const out = (line: string): void => void lines.push(line);
    const cwd = process.cwd();
    let secret: Project | undefined;
    process.chdir(REPOSITORY);
    try {
      assert.equal(await main(["status"], env, out), 0);
      assert.match(lines.join("\n"), /0 applied, 3 pending/);
      lines.length = 0;
      assert.equal(await main(["migrate"], env, out), 0);
      assert.match(lines.join("\n"), /Applied 3 migration/);
      lines.length = 0;
      assert.equal(await main(["provision"], env, out), 1, "provision without a password file must fail");
      assert.match(lines.join("\n"), /APP_PASSWORD_FILE/);
      lines.length = 0;
      // secrets-allow: secret-assignment -- a made-up value for a throw-away test database, not a credential
      secret = createProject({ password: "a-long-enough-password-0123456789\n" });
      assert.equal(await main(["provision"], { ...env, APP_PASSWORD_FILE: join(secret.root, "password") }, out), 0);
      assert.match(lines.join("\n"), /Nothing to apply/);
      assert.match(lines.join("\n"), /has its password/);
      assert.equal((await db.connection.run("select rolpassword is not null from pg_authid where rolname = 'sms_app';")).trim(), "t");
    } finally {
      process.chdir(cwd);
      secret?.cleanup();
    }
  });

  test("an unsafe database name is refused", async () => {
    const never = (): Promise<never> => Promise.reject(new Error("must not be called"));
    const fake: Connection = { config: { host: "h", port: 1, user: "x", database: "a; drop database b" }, run: never, query: never };
    await assert.rejects(() => recreateDatabase(fake), /not a safe database name/);
  });
});

describe("the command line without a database", () => {
  const collect = async (argv: string[], env: Record<string, string>): Promise<{ code: number; text: string }> => {
    const lines: string[] = [];
    const code = await main(argv, env, (line) => void lines.push(line));
    return { code, text: lines.join("\n") };
  };

  test("no command prints the usage, an unknown one is a mistake", async () => {
    assert.equal((await collect([], {})).code, 0);
    assert.match((await collect([], {})).text, /provision/);
    assert.equal((await collect(["drop-everything"], {})).code, 2);
  });
  test("reset refuses a database on another machine", async () => {
    const result = await collect(["reset"], { PGHOST: "db.example.org", SMS_ENV: "local" });
    assert.equal(result.code, 1);
    assert.match(result.text, /Refusing to reset the database on db\.example\.org/);
  });
  test("seed and reset refuse a production environment", async () => {
    assert.match((await collect(["seed"], { SMS_ENV: "production" })).text, /Refusing to seed/);
    assert.match((await collect(["reset"], { SMS_ENV: "production" })).text, /Refusing to reset the database/);
  });
  test("a stopped database is explained, and the password is never printed", async () => {
    const result = await collect(["migrate"], { PGHOST: "127.0.0.1", PGPORT: "1", PGPASSWORD: "do-not-print-this-secret" });
    assert.equal(result.code, 1);
    assert.match(result.text, /Cannot reach PostgreSQL at 127\.0\.0\.1:1/);
    assert.doesNotMatch(result.text, /do-not-print-this-secret/);
  });
  test("a failing script is reported with the database's own words", async () => {
    const error = new SqlError("PostgreSQL refused the script: boom", "ERROR:  boom");
    assert.equal(error.output, "ERROR:  boom");
  });
});
