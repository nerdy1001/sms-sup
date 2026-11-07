import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { assertIdentity, runAs, SET_CONTEXT_SQL, type SqlExecutor } from "./context.ts";

const identity = { userId: "00000000-0000-4000-8000-000000000002", role: "attache" };

function recorder(): { executor: SqlExecutor; log: string[]; calls: (readonly unknown[] | undefined)[] } {
  const log: string[] = [];
  const calls: (readonly unknown[] | undefined)[] = [];
  return {
    log,
    calls,
    executor: {
      query(text, values) {
        log.push(text);
        calls.push(values);
        return Promise.resolve(undefined);
      },
    },
  };
}

describe("runAs", () => {
  test("sets the identity inside a transaction and commits", async () => {
    const { executor, log, calls } = recorder();
    const result = await runAs(executor, identity, () => {
      log.push("work");
      return Promise.resolve(42);
    });
    assert.equal(result, 42);
    assert.deepEqual(log, ["begin", SET_CONTEXT_SQL, "work", "commit"]);
    assert.deepEqual(calls[1], [identity.userId, identity.role]);
  });

  test("rolls back and rethrows when the work fails", async () => {
    const { executor, log } = recorder();
    await assert.rejects(
      runAs(executor, identity, () => Promise.reject(new Error("boom"))),
      /boom/,
    );
    assert.deepEqual(log, ["begin", SET_CONTEXT_SQL, "rollback"]);
  });

  test("rolls back when setting the identity fails", async () => {
    const log: string[] = [];
    const executor: SqlExecutor = {
      query(text) {
        log.push(text);
        return text === SET_CONTEXT_SQL ? Promise.reject(new Error("no")) : Promise.resolve(undefined);
      },
    };
    await assert.rejects(
      runAs(executor, identity, () => Promise.resolve(1)),
      /no/,
    );
    assert.deepEqual(log, ["begin", SET_CONTEXT_SQL, "rollback"]);
  });

  test("an invalid identity never reaches the database", async () => {
    const { executor, log } = recorder();
    await assert.rejects(
      runAs(executor, { userId: "1; drop table x", role: "attache" }, () => Promise.resolve(1)),
      /UUID/,
    );
    await assert.rejects(
      runAs(executor, { userId: identity.userId, role: "Admin" }, () => Promise.resolve(1)),
      /role/,
    );
    assert.deepEqual(log, []);
  });
});

test("the identity values are passed as parameters, never written into the statement", () => {
  assert.ok(!SET_CONTEXT_SQL.includes(identity.userId));
  assert.match(SET_CONTEXT_SQL, /\$1/);
  assert.doesNotThrow(() => assertIdentity(identity));
});
