import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { join } from "node:path";
import { SET_CONTEXT_SQL } from "../../apps/core-api/src/kernel/db/context.ts";
import { migrate, recreateDatabase, seed } from "./migrate.ts";
import { openTestDatabase, SKIP_MESSAGE, type TestDatabase } from "./test-database.ts";

/**
 * Row-level security, tested against a real PostgreSQL as the role the application uses. These tests
 * are the evidence that the policies do what the migrations say.
 */

const REPOSITORY = join(import.meta.dirname, "..", "..");
const ADMIN = { userId: "00000000-0000-4000-8000-000000000001", role: "administrator" };
const ATTACHE = { userId: "00000000-0000-4000-8000-000000000002", role: "attache" };
const FINANCE = { userId: "00000000-0000-4000-8000-000000000003", role: "finance_officer" };
const AUDITOR = { userId: "00000000-0000-4000-8000-000000000004", role: "auditor" };
type Who = typeof ADMIN | undefined;

let database: TestDatabase | undefined;
before(() => {
  database = openTestDatabase();
  if (database === undefined) {
    process.stderr.write(`# row-level security tests skipped: ${SKIP_MESSAGE}\n`);
    return;
  }
  recreateDatabase(database.connection);
  migrate(database.connection, REPOSITORY, "core-api");
  seed(database.connection, REPOSITORY, "core-api");
});
after(() => database?.close());

/** Runs statements as the application role, inside a transaction, with the identity set by the real statement. */
function asApp(who: Who, sql: string): string {
  const context =
    who === undefined
      ? ""
      : `prepare context(text, text) as ${SET_CONTEXT_SQL};\nexecute context('${who.userId}', '${who.role}');\nselect '--';\n`;
  const output = (database as TestDatabase).connection.run(`set role sms_app;\nbegin;\n${context}${sql}\ncommit;`);
  return output.split("--\n").pop()?.trim() ?? "";
}
const owner = (sql: string): string => (database as TestDatabase).connection.run(sql).trim();

const check = (name: string, body: () => void): void => {
  test(name, (context) => {
    if (database === undefined) context.skip(SKIP_MESSAGE);
    else body();
  });
};

describe("the application role", () => {
  check("is not a superuser, cannot bypass row-level security and cannot create anything", () => {
    assert.equal(owner("select rolsuper, rolbypassrls, rolcreatedb, rolcreaterole from pg_roles where rolname = 'sms_app';"), "f|f|f|f");
    assert.throws(() => asApp(ADMIN, "create table platform.sneaky (a int);"), /permission denied/);
    assert.throws(() => asApp(ADMIN, "create table public.sneaky (a int);"), /permission denied/);
  });
  check("cannot read the migration history", () => {
    assert.throws(() => asApp(ADMIN, "select * from platform.schema_migrations;"), /permission denied/);
  });
  check("cannot turn row-level security off", () => {
    assert.throws(() => asApp(ADMIN, "alter table platform.users disable row level security;"), /must be owner/);
    assert.throws(() => asApp(ADMIN, "set row_security = off; select count(*) from platform.users;"), /row-level security|row_security|permission/i);
  });
  check("every table of the platform schema has row-level security enabled and forced, except the migration history", () => {
    const rows = owner("select c.relname, c.relrowsecurity, c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'platform' and c.relkind = 'r' order by c.relname;");
    assert.equal(rows, "audit_log|t|t\nschema_migrations|t|f\nusers|t|t");
  });
});

describe("without an identity the database refuses by default", () => {
  check("no staff member is visible", () => {
    assert.equal(asApp(undefined, "select count(*) from platform.users;"), "0");
  });
  check("nothing can be written", () => {
    assert.throws(() => asApp(undefined, "insert into platform.users (email, display_name, role) values ('x@example.invalid', 'X', 'administrator');"), /row-level security/);
    assert.throws(() => asApp(undefined, "insert into platform.audit_log (actor_id, actor_role, action, object_type) values (gen_random_uuid(), 'attache', 'a', 'b');"), /row-level security/);
  });
  check("an identity does not survive its transaction", () => {
    const output = (database as TestDatabase).connection.run(
      `set role sms_app;\nbegin;\nprepare context(text, text) as ${SET_CONTEXT_SQL};\nexecute context('${ADMIN.userId}', 'administrator');\ncommit;\nselect count(*) from platform.users;`,
    );
    assert.equal(output.trim().split("\n").pop(), "0");
  });
  check("a malformed identity makes the query fail instead of showing rows", () => {
    assert.throws(
      () => (database as TestDatabase).connection.run("set role sms_app;\nbegin;\nselect set_config('app.user_id', 'not-a-uuid', true);\nselect count(*) from platform.users;\ncommit;"),
      /invalid input syntax for type uuid/,
    );
  });
});

describe("staff members (platform.users)", () => {
  check("an attache sees only their own row", () => {
    assert.equal(asApp(ATTACHE, "select email from platform.users order by email;"), "attache@example.invalid");
  });
  check("an auditor and a finance officer also see only their own row", () => {
    assert.equal(asApp(AUDITOR, "select count(*) from platform.users;"), "1");
    assert.equal(asApp(FINANCE, "select count(*) from platform.users;"), "1");
  });
  check("an administrator sees everyone", () => {
    assert.equal(asApp(ADMIN, "select count(*) from platform.users;"), "4");
  });
  check("a staff member cannot promote themselves", () => {
    const updated = asApp(ATTACHE, "update platform.users set role = 'administrator' where id = platform.current_user_id() returning id;");
    assert.equal(updated, "");
    assert.equal(owner("select role from platform.users where id = '" + ATTACHE.userId + "';"), "attache");
  });
  check("a staff member cannot create or delete staff members", () => {
    assert.throws(() => asApp(ATTACHE, "insert into platform.users (email, display_name, role) values ('x@example.invalid', 'X', 'administrator');"), /row-level security/);
    assert.equal(asApp(ATTACHE, "delete from platform.users where id = platform.current_user_id() returning id;"), "");
    assert.equal(owner("select count(*) from platform.users;"), "4");
  });
  check("an administrator can add, change and remove a staff member", () => {
    asApp(ADMIN, "insert into platform.users (id, email, display_name, role) values ('00000000-0000-4000-8000-0000000000aa', 'temp@example.invalid', 'Temp', 'attache');");
    assert.equal(asApp(ADMIN, "update platform.users set active = false where email = 'temp@example.invalid' returning active;"), "f");
    assert.equal(asApp(ADMIN, "delete from platform.users where email = 'temp@example.invalid' returning email;"), "temp@example.invalid");
  });
  check("the data rules hold for everyone: lowercase addresses, known roles, unique addresses", () => {
    assert.throws(() => asApp(ADMIN, "insert into platform.users (email, display_name, role) values ('Upper@example.invalid', 'X', 'attache');"), /users_email_lowercase/);
    assert.throws(() => asApp(ADMIN, "insert into platform.users (email, display_name, role) values ('y@example.invalid', 'X', 'wizard');"), /users_role_known/);
    assert.throws(() => asApp(ADMIN, "insert into platform.users (email, display_name, role) values ('admin@example.invalid', 'X', 'attache');"), /users_email_unique/);
  });
});

describe("the audit log (platform.audit_log)", () => {
  const entry = (who: { userId: string; role: string }, action: string): string =>
    `insert into platform.audit_log (actor_id, actor_role, action, object_type, object_id) values ('${who.userId}', '${who.role}', '${action}', 'scholar', 'SYN-000001');`;

  check("a staff member can add an entry in their own name", () => {
    asApp(ATTACHE, entry(ATTACHE, "scholar.viewed"));
    assert.equal(owner("select count(*) from platform.audit_log where action = 'scholar.viewed';"), "1");
  });
  check("an entry in someone else's name, or with another role, is refused", () => {
    assert.throws(() => asApp(ATTACHE, entry(ADMIN, "scholar.faked")), /row-level security/);
    assert.throws(() => asApp(ATTACHE, entry({ userId: ATTACHE.userId, role: "administrator" }, "scholar.faked")), /row-level security/);
  });
  check("only auditors and administrators can read it", () => {
    assert.equal(asApp(ATTACHE, "select count(*) from platform.audit_log;"), "0");
    assert.equal(asApp(FINANCE, "select count(*) from platform.audit_log;"), "0");
    assert.notEqual(asApp(AUDITOR, "select count(*) from platform.audit_log;"), "0");
    assert.notEqual(asApp(ADMIN, "select count(*) from platform.audit_log;"), "0");
  });
  check("it only grows: no update, no delete, no truncate, even for the owner of the table", () => {
    assert.throws(() => asApp(ADMIN, "update platform.audit_log set action = 'edited' returning id;"), /permission denied/);
    assert.throws(() => asApp(ADMIN, "delete from platform.audit_log returning id;"), /permission denied/);
    assert.throws(() => asApp(ADMIN, "truncate platform.audit_log;"), /permission denied/);
    assert.throws(() => owner("update platform.audit_log set action = 'edited';"), /append-only/);
    assert.throws(() => owner("delete from platform.audit_log;"), /append-only/);
    assert.throws(() => owner("truncate platform.audit_log;"), /append-only/);
    assert.equal(owner("select count(*) from platform.audit_log where action = 'edited';"), "0");
  });
  check("an entry needs an action and an object type", () => {
    assert.throws(() => asApp(ATTACHE, entry(ATTACHE, "")), /audit_log_action_not_empty/);
  });
});
