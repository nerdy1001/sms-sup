import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { checkMigrations, splitStatements } from "./migrations.ts";
import { createProject, type Project } from "../test-support/project.ts";

let project: Project | undefined;
afterEach(() => {
  project?.cleanup();
  project = undefined;
});

const KERNEL = "apps/core-api/src/kernel/db/migrations";
const SEEDS = "apps/core-api/src/kernel/db/seeds";
const MODULE = "apps/core-api/src/modules/registry/internal/infrastructure/migrations";

const rules = (files: Record<string, string>): string[] => {
  project = createProject(files);
  return checkMigrations(project.root).findings.map((item) => item.rule);
};

const SAFE_TABLE = [
  "create table platform.things (id int primary key);",
  "alter table platform.things enable row level security;",
  "alter table platform.things force row level security;",
  "create policy things_read on platform.things for select to sms_app using (platform.has_role('administrator'));",
].join("\n");

describe("splitting statements", () => {
  test("splits at semicolons and records the line", () => {
    const parts = splitStatements("select 1;\n\nselect 2;");
    assert.deepEqual(
      parts.map((item) => [item.text, item.line]),
      [
        ["select 1", 1],
        ["select 2", 3],
      ],
    );
  });
  test("keeps a function body in one statement", () => {
    const sql = "create function f() returns int language plpgsql as $$\nbegin\n  return 1;\nend\n$$;\nselect 2;";
    const parts = splitStatements(sql);
    assert.equal(parts.length, 2);
    assert.match(parts[0]?.text ?? "", /^create function f/);
  });
  test("keeps tagged bodies and quoted semicolons together", () => {
    assert.equal(splitStatements("do $body$ begin perform 1; end $body$; select 'a;b';").length, 2);
  });
  test("ignores comments, including ones with semicolons", () => {
    assert.deepEqual(
      splitStatements("-- one; two\nselect 1; /* x; y */ select 2;").map((item) => item.text),
      ["select 1", "select 2"],
    );
  });
});

describe("a clean set of files", () => {
  test("passes", () => {
    assert.deepEqual(
      rules({
        [`${KERNEL}/0001_a.sql`]: SAFE_TABLE,
        [`${KERNEL}/0002_b.sql`]: "create schema if not exists platform;",
        [`${SEEDS}/0001_s.sql`]: "insert into platform.things values (1) on conflict do nothing;",
      }),
      [],
    );
  });
  test("no SQL files at all passes", () => {
    assert.deepEqual(rules({}), []);
  });
});

describe("row-level security", () => {
  test("a table without it is an error", () => {
    assert.deepEqual(rules({ [`${KERNEL}/0001_a.sql`]: "create table platform.things (id int);" }), ["migration-rls-missing"]);
  });
  test("a table with it enabled but not forced is an error", () => {
    assert.deepEqual(
      rules({ [`${KERNEL}/0001_a.sql`]: "create table platform.things (id int);\nalter table platform.things enable row level security;" }),
      ["migration-rls-not-forced"],
    );
  });
  test("it must be on the same table", () => {
    assert.deepEqual(
      rules({
        [`${KERNEL}/0001_a.sql`]:
          "create table platform.a (id int);\ncreate table platform.b (id int);\nalter table platform.a enable row level security;\nalter table platform.a force row level security;",
      }),
      ["migration-rls-missing"],
    );
  });
  test("a module table is held to the same rule", () => {
    assert.deepEqual(rules({ [`${MODULE}/0001_a.sql`]: "create schema registry;\ncreate table registry.t (id int);" }), [
      "migration-rls-missing",
    ]);
  });
  test("a comment that mentions the statement does not count", () => {
    assert.deepEqual(
      rules({ [`${KERNEL}/0001_a.sql`]: "create table platform.t (id int);\n-- alter table platform.t enable row level security;" }),
      ["migration-rls-missing"],
    );
  });
  test("a table without a schema is an error", () => {
    assert.ok(rules({ [`${MODULE}/0001_a.sql`]: "create table t (id int);" }).includes("migration-unqualified-object"));
  });
  test("a temporary table is not a data table", () => {
    assert.deepEqual(rules({ [`${KERNEL}/0001_a.sql`]: "create temporary table scratch (id int);" }), []);
  });
});

describe("other migration rules", () => {
  test("transaction control is refused", () => {
    assert.deepEqual(rules({ [`${KERNEL}/0001_a.sql`]: "begin;\nselect 1;\ncommit;" }), [
      "migration-transaction-control",
      "migration-transaction-control",
    ]);
  });
  test("begin inside a function body is fine", () => {
    assert.deepEqual(
      rules({ [`${KERNEL}/0001_a.sql`]: "create function platform.f() returns int language plpgsql as $$ begin return 1; end $$;" }),
      [],
    );
  });
  test("granting to public is refused", () => {
    assert.deepEqual(rules({ [`${KERNEL}/0001_a.sql`]: "grant select on platform.x to public;" }), ["migration-grant-public"]);
    assert.deepEqual(rules({ [`${KERNEL}/0001_a.sql`]: "grant select on platform.x to sms_app;" }), []);
  });
  test("a security definer function must fix its search path", () => {
    const bad = "create function platform.f() returns int language sql security definer as $$ select 1 $$;";
    const good = "create function platform.f() returns int language sql security definer set search_path = pg_catalog as $$ select 1 $$;";
    assert.deepEqual(rules({ [`${KERNEL}/0001_a.sql`]: bad }), ["migration-security-definer"]);
    assert.deepEqual(rules({ [`${KERNEL}/0001_a.sql`]: good }), []);
  });
  test("deleting data is a warning, not an error", () => {
    project = createProject({ [`${KERNEL}/0001_a.sql`]: "drop table platform.old;" });
    const found = checkMigrations(project.root).findings;
    assert.deepEqual(
      found.map((item) => [item.rule, item.severity]),
      [["migration-destructive", "warning"]],
    );
  });
  test("a platform migration may not touch another schema or create without a schema", () => {
    assert.deepEqual(rules({ [`${KERNEL}/0001_a.sql`]: "select * from registry.scholars;" }), ["migration-foreign-schema"]);
    assert.deepEqual(rules({ [`${KERNEL}/0001_a.sql`]: "create view v as select 1;" }), ["migration-unqualified-object"]);
    assert.deepEqual(rules({ [`${KERNEL}/0001_a.sql`]: "select pg_catalog.now(); select * from information_schema.tables;" }), []);
  });
});

describe("names and numbers", () => {
  test("a badly named file is an error", () => {
    assert.deepEqual(rules({ [`${KERNEL}/users.sql`]: "select 1;" }), ["migration-name"]);
    assert.deepEqual(rules({ [`${KERNEL}/0001_Users.sql`]: "select 1;" }), ["migration-name"]);
  });
  test("numbers must start at 0001 and have no gaps", () => {
    assert.deepEqual(rules({ [`${KERNEL}/0002_a.sql`]: "select 1;" }), ["migration-sequence"]);
    assert.deepEqual(rules({ [`${KERNEL}/0001_a.sql`]: "select 1;", [`${KERNEL}/0003_c.sql`]: "select 1;" }), ["migration-sequence"]);
  });
  test("a number used twice is an error", () => {
    const found = rules({ [`${KERNEL}/0001_a.sql`]: "select 1;", [`${KERNEL}/0001_b.sql`]: "select 1;" });
    assert.deepEqual(found, ["migration-sequence"]);
  });
  test("each module counts from 0001 on its own", () => {
    assert.deepEqual(rules({ [`${KERNEL}/0001_a.sql`]: "select 1;", [`${MODULE}/0001_a.sql`]: "create schema registry;" }), []);
  });
  test("seeds are numbered separately from migrations", () => {
    assert.deepEqual(rules({ [`${KERNEL}/0001_a.sql`]: "select 1;", [`${SEEDS}/0001_s.sql`]: "select 1;" }), []);
  });
});

describe("seeds", () => {
  test("an insert without on conflict is an error", () => {
    assert.deepEqual(rules({ [`${SEEDS}/0001_s.sql`]: "insert into platform.users (id) values (1);" }), ["seed-not-repeatable"]);
  });
  test("an insert with on conflict passes", () => {
    assert.deepEqual(rules({ [`${SEEDS}/0001_s.sql`]: "insert into platform.users (id) values (1) on conflict (id) do nothing;" }), []);
  });
  test("a seed is not held to the migration rules", () => {
    assert.deepEqual(rules({ [`${SEEDS}/0001_s.sql`]: "begin;\nselect 1;\ncommit;" }), []);
  });
});
