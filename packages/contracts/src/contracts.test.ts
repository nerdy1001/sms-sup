import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ERROR_CODES, errorCodeSchema, healthSchema, problemSchema, readySchema } from "./index.ts";

describe("contracts", () => {
  test("the error codes are unique and written in lowercase with underscores", () => {
    assert.equal(new Set(ERROR_CODES).size, ERROR_CODES.length);
    for (const code of ERROR_CODES) assert.match(code, /^[a-z]+(_[a-z]+)*$/);
  });

  test("a code outside the list is refused", () => {
    assert.ok(errorCodeSchema.safeParse("not_found").success);
    assert.ok(!errorCodeSchema.safeParse("teapot").success);
  });

  test("a problem needs its type, title, status, code and request id; the rest is optional", () => {
    const minimal = { type: "urn:sms:error:not_found", title: "x", status: 404, code: "not_found", requestId: "r1" };
    assert.ok(problemSchema.safeParse(minimal).success);
    assert.ok(problemSchema.safeParse({ ...minimal, detail: "d", errors: [{ path: "body.a", code: "required" }] }).success);
    assert.ok(!problemSchema.safeParse({ ...minimal, requestId: undefined }).success);
    assert.ok(!problemSchema.safeParse({ ...minimal, status: 4.5 }).success);
  });

  test("the health answers have a fixed status", () => {
    assert.ok(healthSchema.safeParse({ status: "ok", service: "core-api", version: "abc" }).success);
    assert.ok(!healthSchema.safeParse({ status: "fine", service: "core-api", version: "abc" }).success);
    assert.ok(readySchema.safeParse({ status: "ready" }).success);
  });
});
