import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  AppError,
  conflict,
  ERROR_DEFINITIONS,
  forbidden,
  isAppError,
  notFound,
  unauthenticated,
  unavailable,
  validationFailed,
  type ErrorCode,
} from "./app-error.ts";
import { problemFromStatus, problemType, toProblem } from "./problem.ts";

const REQUEST_ID = "req-1";

describe("AppError", () => {
  test("every code has a status and a title", () => {
    for (const [code, entry] of Object.entries(ERROR_DEFINITIONS)) {
      assert.ok(entry.status >= 400 && entry.status < 600, code);
      assert.ok(entry.title.length > 0, code);
    }
  });
  test("the status follows the code", () => {
    assert.equal(notFound().status, 404);
    assert.equal(forbidden().status, 403);
    assert.equal(unauthenticated().status, 401);
    assert.equal(conflict("x").status, 409);
    assert.equal(unavailable("x").status, 503);
    assert.equal(validationFailed([]).status, 400);
  });
  test("keeps its cause for the log", () => {
    const cause = new Error("db down");
    assert.equal(unavailable("The database does not answer.", cause).cause, cause);
  });
  test("is recognised, and a plain Error is not", () => {
    assert.ok(isAppError(notFound()));
    assert.ok(!isAppError(new Error("x")));
    assert.ok(!isAppError({ code: "not_found" }));
  });
});

describe("toProblem", () => {
  test("an AppError becomes a problem with its code, title and request id", () => {
    const problem = toProblem(notFound("No such scholar."), REQUEST_ID);
    assert.deepEqual(problem, {
      type: "urn:sms:error:not_found",
      title: ERROR_DEFINITIONS.not_found.title,
      status: 404,
      code: "not_found",
      detail: "No such scholar.",
      requestId: REQUEST_ID,
    });
  });
  test("field problems are included for a caller error", () => {
    const problem = toProblem(validationFailed([{ path: "body.email", code: "invalid_format" }]), REQUEST_ID);
    assert.deepEqual(problem.errors, [{ path: "body.email", code: "invalid_format" }]);
  });
  test("details are never sent with a server error", () => {
    const error = new AppError("unavailable", "down", { details: [{ path: "internal.table", code: "x" }] });
    assert.equal(toProblem(error, REQUEST_ID).errors, undefined);
  });
  test("an unknown error reveals nothing", () => {
    const secret = new Error("select * from registry.scholars where bank_account = '123456'");
    secret.stack = "at /srv/app/secret/path.ts:1";
    const problem = toProblem(secret, REQUEST_ID);
    const text = JSON.stringify(problem);
    assert.equal(problem.status, 500);
    assert.equal(problem.code, "internal_error");
    assert.ok(!text.includes("select"));
    assert.ok(!text.includes("bank_account"));
    assert.ok(!text.includes("/srv/app"));
    assert.equal(problem.detail, undefined);
  });
  test("things that are not errors at all are handled", () => {
    for (const thrown of [undefined, null, "text", 42, { message: "x" }])
      assert.equal(toProblem(thrown, REQUEST_ID).code, "internal_error");
  });
  test("the type is a stable URN per code", () => {
    for (const code of Object.keys(ERROR_DEFINITIONS) as ErrorCode[]) assert.equal(problemType(code), `urn:sms:error:${code}`);
  });
});

describe("problemFromStatus", () => {
  test("maps the statuses the framework produces", () => {
    assert.equal(problemFromStatus(404, REQUEST_ID).code, "not_found");
    assert.equal(problemFromStatus(405, REQUEST_ID).code, "method_not_allowed");
    assert.equal(problemFromStatus(413, REQUEST_ID).code, "payload_too_large");
    assert.equal(problemFromStatus(429, REQUEST_ID).code, "rate_limited");
    assert.equal(problemFromStatus(400, REQUEST_ID).code, "validation_failed");
    assert.equal(problemFromStatus(502, REQUEST_ID).code, "internal_error");
  });
  test("the status in the body matches the status asked for", () => {
    for (const status of [400, 404, 405, 413, 429, 500]) assert.equal(problemFromStatus(status, REQUEST_ID).status, status);
  });
});
