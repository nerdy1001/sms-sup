import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { AppError } from "../errors/app-error.ts";
import { createLogger, errorFields, REDACTED, SENSITIVE_KEYS } from "./logger.ts";

function capture() {
  const lines: string[] = [];
  const logger = createLogger(
    { level: "debug", service: "core-api", version: "abc123" },
    { write: (line: string) => void lines.push(line) },
  );
  const parsed = (): Record<string, unknown>[] => lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  return { logger, lines, parsed };
}

describe("log lines", () => {
  test("are JSON with the level as a word, the time in UTC, the service and the version", () => {
    const { logger, parsed } = capture();
    logger.info({ requestId: "r1" }, "hello");
    const [line] = parsed();
    assert.equal(line?.["level"], "info");
    assert.equal(line?.["msg"], "hello");
    assert.equal(line?.["service"], "core-api");
    assert.equal(line?.["version"], "abc123");
    assert.equal(line?.["requestId"], "r1");
    assert.match(String(line?.["time"]), /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    assert.equal(line?.["pid"], undefined);
    assert.equal(line?.["hostname"], undefined);
  });

  test("below the chosen level nothing is written", () => {
    const lines: string[] = [];
    const logger = createLogger({ level: "warn", service: "s", version: "v" }, { write: (line: string) => void lines.push(line) });
    logger.info("quiet");
    logger.warn("loud");
    assert.equal(lines.length, 1);
  });
});

describe("redaction", () => {
  test("sensitive fields are replaced, at the top and up to four levels down", () => {
    const { logger, lines } = capture();
    logger.info({
      password: "p1",
      user: { email: "a@b.cm", profile: { phone: "699000000", deep: { token: "t1" } } },
      list: [{ firstName: "Awa" }],
    });
    const text = lines.join("");
    for (const secret of ["p1", "a@b.cm", "699000000", "t1", "Awa"]) assert.ok(!text.includes(secret), secret);
    assert.ok(text.includes(REDACTED));
  });

  test("snake_case and kebab-case spellings are caught, including header names", () => {
    const { logger, lines } = capture();
    logger.info({ date_of_birth: "2001-02-03", headers: { authorization: "Bearer abc", "set-cookie": "sid=1", "x-api-key": "k1" } });
    const text = lines.join("");
    for (const secret of ["2001-02-03", "Bearer abc", "sid=1"]) assert.ok(!text.includes(secret), secret);
  });

  test("a field with another name is written as it is: redaction is a safety net, not a licence", () => {
    const { logger, parsed } = capture();
    logger.info({ requestId: "r1", status: 200 });
    assert.equal(parsed()[0]?.["status"], 200);
  });

  test("every listed key is actually redacted", () => {
    const { logger, lines } = capture();
    for (const key of SENSITIVE_KEYS) logger.info({ [key]: "SECRET-VALUE" });
    assert.ok(!lines.join("").includes("SECRET-VALUE"));
    assert.equal(lines.length, SENSITIVE_KEYS.length);
  });
});

describe("errors in the log", () => {
  test("a database error keeps its code and loses its message and detail", () => {
    const error = Object.assign(new Error('duplicate key value violates unique constraint "users_email_key"'), {
      name: "error",
      code: "23505",
      detail: "Key (email)=(awa@example.cm) already exists.",
    });
    const fields = errorFields(error);
    assert.equal(fields.errorCode, "23505");
    assert.equal(fields.errorMessage, undefined);
    assert.ok(!JSON.stringify(fields).includes("awa@example.cm"));
    assert.ok(!JSON.stringify(fields).includes("duplicate key"));
    assert.ok((fields.stack ?? "").startsWith("    at "));
  });

  test("an error that was raised on purpose keeps its message and its cause is described too", () => {
    const fields = errorFields(
      new AppError("unavailable", "The database does not answer.", { cause: new TypeError("x is not a function") }),
    );
    assert.equal(fields.errorType, "AppError");
    assert.equal(fields.errorMessage, "The database does not answer.");
    assert.equal(fields.cause?.errorType, "TypeError");
    assert.equal(fields.cause?.errorMessage, "x is not a function");
  });

  test("a framework error keeps its message; a plain Error does not", () => {
    assert.equal(
      errorFields(Object.assign(new Error("Body is not valid JSON"), { code: "FST_ERR_CTP_INVALID_JSON_BODY" })).errorMessage,
      "Body is not valid JSON",
    );
    assert.equal(errorFields(new Error("could not find awa@example.cm")).errorMessage, undefined);
  });

  test("a raw error logged under err or error is made safe on the way out", () => {
    const { logger, lines } = capture();
    const error = Object.assign(new Error("value awa@example.cm is wrong"), { code: "22P02" });
    logger.error({ err: error }, "failed");
    logger.error({ error }, "failed");
    assert.ok(!lines.join("").includes("awa@example.cm"));
  });

  test("something that is not an error is described by its type only", () => {
    assert.deepEqual(errorFields("awa@example.cm"), { errorType: "string" });
    assert.deepEqual(errorFields(null), { errorType: "object" });
  });
});
