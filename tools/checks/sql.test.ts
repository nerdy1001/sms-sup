import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { checkSql } from "./sql.ts";
import { createProject, moduleFiles, type Project } from "../test-support/project.ts";

let project: Project | undefined;
afterEach(() => {
  project?.cleanup();
  project = undefined;
});

const dir = "apps/core-api/src/modules/registry";

function run(files: Record<string, string>): { rule: string; line: number | undefined }[] {
  project = createProject({ ...moduleFiles("core-api", "registry", "RG"), ...files });
  return checkSql(project.root).findings.map((item) => ({ rule: item.rule, line: item.line }));
}

test("a module that only touches its own schema and the shared one passes", () => {
  const found = run({
    [`${dir}/migrations/001.sql`]: [
      "create schema if not exists registry;",
      "create table registry.scholars (id uuid primary key);",
      "create index scholars_idx on registry.scholars (id);",
      "create temp table scratch (x int);",
      "insert into platform.audit_log (event) values ('x');",
      "select * from pg_catalog.pg_tables;",
    ].join("\n"),
    [`${dir}/internal/infrastructure/repo.ts`]: 'export const q = "select id from registry.scholars where id = $1";\nexport const r = `insert into registry.scholars (id) values (${1})`;\n',
  });
  assert.deepEqual(found, []);
});

describe("violations", () => {
  test("a query reads another module's table", () => {
    const found = run({ [`${dir}/internal/infrastructure/repo.ts`]: 'export const q = "select * from payments.payments";\n' });
    assert.deepEqual(found, [{ rule: "sql-foreign-schema", line: 1 }]);
  });

  test("a join in a template literal reaches into another schema, with the right line number", () => {
    const found = run({ [`${dir}/internal/infrastructure/repo.ts`]: "export const a = 1;\nexport const q = `\n  select 1\n  from registry.scholars s\n  join documents.files f on f.id = s.id\n`;\n" });
    assert.deepEqual(found, [{ rule: "sql-foreign-schema", line: 5 }]);
  });

  test("a migration references or creates in another schema", () => {
    const found = run({ [`${dir}/migrations/002.sql`]: "alter table registry.x add column y int;\ncreate table commitments.c (id int);\ncreate schema other;\n" });
    assert.deepEqual(found.map((item) => item.rule).sort(), ["sql-foreign-schema", "sql-foreign-schema"]);
  });

  test("a table is created without a schema", () => {
    const found = run({ [`${dir}/migrations/003.sql`]: "create table scholars (id int);\n" });
    assert.deepEqual(found, [{ rule: "sql-unqualified-object", line: 1 }]);
  });

  test("a view and a function are created without a schema", () => {
    const found = run({ [`${dir}/migrations/004.sql`]: "create or replace view v as select 1;\ncreate function f() returns int language sql as 'select 1';\n" });
    assert.deepEqual(found.map((item) => item.rule), ["sql-unqualified-object", "sql-unqualified-object"]);
  });
});

describe("things that are not SQL are left alone", () => {
  test("import paths, comments and ordinary text do not trigger the check", () => {
    const found = run({
      [`${dir}/internal/infrastructure/repo.ts`]:
        'import something from "zod.js";\n// select * from payments.payments\nexport const message = "update the record soon";\nexport const x = something;\n',
      [`${dir}/migrations/005.sql`]: "-- select * from payments.payments\n/* join documents.files */\nselect 1;\n",
    });
    assert.deepEqual(found, []);
  });

  test("code outside the infrastructure layer is not scanned for SQL", () => {
    const found = run({ [`${dir}/internal/application/a.ts`]: 'export const note = "from payments.payments";\n' });
    assert.deepEqual(found, []);
  });

  test("a schema listed in extraSchemas is allowed", () => {
    project = createProject({
      ...moduleFiles("core-api", "registry", "RG"),
      [`${dir}/module.json`]: JSON.stringify({ code: "RG", name: "registry", title: "r", dependsOn: [], database: { schema: "registry", extraSchemas: ["documents"] } }),
      [`${dir}/migrations/006.sql`]: "select * from documents.files;\n",
    });
    assert.deepEqual(checkSql(project.root).findings, []);
  });
});
