import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Queryable } from "../db/database.ts";
import {
  assertSafeDetail,
  assertValidEntry,
  createTrail,
  isValidDeclaration,
  MAX_ENTRIES_PER_REQUEST,
  writeAuditEntries,
  type AuditDetail,
} from "./audit.ts";

const IDENTITY = { userId: "00000000-0000-4000-8000-000000000002", role: "attache" };

function recorder() {
  const calls: { text: string; values: readonly unknown[] }[] = [];
  const database: Queryable = {
    query<Row extends object>(text: string, values: readonly unknown[] = []) {
      calls.push({ text, values });
      return Promise.resolve({ rows: [] as Row[], rowCount: 0 });
    },
  };
  return { calls, database };
}

describe("what a route declares", () => {
  test("an object, a dot and a verb, with the kind of object", () => {
    assert.ok(isValidDeclaration({ action: "scholar.update", objectType: "scholar" }));
    assert.ok(isValidDeclaration({ action: "scholar.payment.approve", objectType: "payment_batch" }));
  });
  test("anything else is refused", () => {
    for (const value of [
      undefined,
      null,
      "scholar.update",
      {},
      { action: "update", objectType: "scholar" },
      { action: "Scholar.Update", objectType: "scholar" },
      { action: "scholar.update", objectType: "Scholar" },
      { action: "scholar.update", objectType: "" },
      { action: "scholar.update", objectType: "a b" },
      { action: 3, objectType: "scholar" },
    ]) {
      assert.equal(isValidDeclaration(value), false, JSON.stringify(value));
    }
  });
});

describe("what the detail of an entry may hold", () => {
  test("identifiers, counts, codes and flags", () => {
    assertSafeDetail({ scholar_id: "a1", changed_fields: 3, dry_run: false, reason: null, level: "master" });
  });
  test("names of personal data are refused, in every spelling that is likely", () => {
    for (const key of ["email", "phone", "first_name", "contact_email", "phone_number", "national_id", "password", "address"]) {
      assert.throws(() => assertSafeDetail({ [key]: "x" }), /personal data/, key);
    }
  });
  test("a value that looks like an e-mail address is refused, whatever the key", () => {
    assert.throws(() => assertSafeDetail({ note: "awa@example.cm" }), /e-mail/);
  });
  test("keys must be lowercase words, and a detail cannot grow without limit", () => {
    for (const key of ["Scholar", "scholar id", "1st", "", "a".repeat(42)]) assert.throws(() => assertSafeDetail({ [key]: 1 }), /key/, key);
    const many: Record<string, number> = {};
    for (let index = 0; index < 21; index += 1) many[`k${index}`] = index;
    assert.throws(() => assertSafeDetail(many), /at most 20/);
    assert.throws(() => assertSafeDetail({ note: "x".repeat(201) }), /longer than/);
  });
  test("nested values and values that are not plain are refused", () => {
    assert.throws(() => assertSafeDetail({ list: [1, 2] } as unknown as AuditDetail), /must be a text/);
    assert.throws(() => assertSafeDetail({ nested: { a: 1 } } as unknown as AuditDetail), /must be a text/);
    assert.throws(() => assertSafeDetail({ amount: Number.NaN }), /finite/);
  });
});

describe("an entry", () => {
  test("needs a well-formed action, object type and object id", () => {
    assertValidEntry({ action: "scholar.read", objectType: "scholar", objectId: "3f2c9d1e-0000-4000-8000-000000000001" });
    assertValidEntry({ action: "access.denied", objectType: "route", objectId: "GET /api/scholars/:id" });
    assert.throws(() => assertValidEntry({ action: "read", objectType: "scholar" }), /action/);
    assert.throws(() => assertValidEntry({ action: "scholar.read", objectType: "Scholar" }), /object type/);
    assert.throws(
      () => assertValidEntry({ action: "scholar.read", objectType: "scholar", objectId: "Awa Mbarga, born 2001" }),
      /identifier/,
    );
    assert.throws(() => assertValidEntry({ action: "scholar.read", objectType: "scholar", objectId: "" }), /identifier/);
  });
});

describe("writing entries", () => {
  test("one statement for all entries, with constant text and every value as a parameter", async () => {
    const { calls, database } = recorder();
    await writeAuditEntries(database, IDENTITY, [
      { action: "scholar.read", objectType: "scholar", objectId: "a1" },
      { action: "scholar.read", objectType: "scholar", objectId: "a2", detail: { source: "search" } },
      { action: "scholar.read", objectType: "scholar" },
    ]);
    assert.equal(calls.length, 1);
    assert.match(calls[0]?.text ?? "", /^insert into platform\.audit_log/);
    assert.doesNotMatch(calls[0]?.text ?? "", /a1|a2|attache|scholar/);
    assert.deepEqual(calls[0]?.values, [
      IDENTITY.userId,
      "attache",
      ["scholar.read", "scholar.read", "scholar.read"],
      ["scholar", "scholar", "scholar"],
      ["a1", "a2", null],
      ["{}", '{"source":"search"}', "{}"],
    ]);
  });
  test("nothing to write means no statement", async () => {
    const { calls, database } = recorder();
    await writeAuditEntries(database, IDENTITY, []);
    assert.equal(calls.length, 0);
  });
  test("an invalid entry stops everything before any statement", async () => {
    const { calls, database } = recorder();
    await assert.rejects(
      writeAuditEntries(database, IDENTITY, [
        { action: "scholar.read", objectType: "scholar" },
        { action: "bad", objectType: "scholar" },
      ]),
      /action/,
    );
    assert.equal(calls.length, 0);
  });
  test("a request cannot write more than the limit", async () => {
    const { calls, database } = recorder();
    const entries = Array.from({ length: MAX_ENTRIES_PER_REQUEST + 1 }, () => ({ action: "scholar.read", objectType: "scholar" }));
    await assert.rejects(writeAuditEntries(database, IDENTITY, entries), /at most/);
    assert.equal(calls.length, 0);
  });
});

describe("the trail that a handler uses", () => {
  const declaration = { action: "scholar.update", objectType: "scholar" };
  test("a record touched is an entry; several records are several entries", () => {
    const { trail, entriesFor } = createTrail();
    trail.object("a1");
    trail.object("a2", { changed_fields: 2 });
    assert.deepEqual(entriesFor(declaration), [
      { action: "scholar.update", objectType: "scholar", objectId: "a1" },
      { action: "scholar.update", objectType: "scholar", objectId: "a2", detail: { changed_fields: 2 } },
    ]);
  });
  test("a request that touched no particular record still leaves one entry", () => {
    assert.deepEqual(createTrail().entriesFor(declaration), [{ action: "scholar.update", objectType: "scholar" }]);
  });
  test("a handler cannot touch more records than the limit", () => {
    const { trail } = createTrail();
    for (let index = 0; index < MAX_ENTRIES_PER_REQUEST; index += 1) trail.object(`id${index}`);
    assert.throws(() => trail.object("one-too-many"), /at most/);
  });
});
