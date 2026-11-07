import assert from "node:assert/strict";
import { inspect } from "node:util";
import { describe, test } from "node:test";
import { ConfigError, loadConfig, type Env } from "./load.ts";
import { Secret } from "./secret.ts";

const noFiles = (): string => {
  throw new Error("no such file");
};
const files =
  (content: Record<string, string>) =>
  (path: string): string => {
    const value = content[path];
    if (value === undefined) throw new Error("no such file");
    return value;
  };
const problems = (env: Env, reader: (path: string) => string = noFiles): readonly string[] => {
  try {
    loadConfig(env, reader);
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
  return [];
};

const STAGING: Env = { SMS_ENV: "staging", DATABASE_HOST: "postgres", DATABASE_PASSWORD_FILE: "/run/secrets/db" };

describe("development", () => {
  test("SMS_ENV=local alone gives a usable configuration", () => {
    const config = loadConfig({ SMS_ENV: "local" }, noFiles);
    assert.equal(config.env, "local");
    assert.deepEqual(config.server, { host: "127.0.0.1", port: 3000, trustProxy: false });
    assert.deepEqual(
      { ...config.database, password: undefined },
      { host: "127.0.0.1", port: 5432, name: "sms", user: "sms_app", password: undefined },
    );
    assert.equal(config.log.level, "info");
    assert.equal(config.version, "dev");
  });
  test("test behaves like local", () => {
    assert.equal(loadConfig({ SMS_ENV: "test" }, noFiles).database.host, "127.0.0.1");
  });
  test("settings can be overridden", () => {
    const config = loadConfig(
      { SMS_ENV: "local", PORT: "4100", HOST: "0.0.0.0", LOG_LEVEL: "debug", DATABASE_NAME: "other", APP_VERSION: "abc" },
      noFiles,
    );
    assert.equal(config.server.port, 4100);
    assert.equal(config.server.host, "0.0.0.0");
    assert.equal(config.log.level, "debug");
    assert.equal(config.database.name, "other");
    assert.equal(config.version, "abc");
  });
  test("the proxy is trusted only when it is said so, in words", () => {
    assert.equal(loadConfig({ SMS_ENV: "local", TRUST_PROXY: "true" }, noFiles).server.trustProxy, true);
    assert.equal(loadConfig({ SMS_ENV: "local", TRUST_PROXY: "false" }, noFiles).server.trustProxy, false);
    assert.throws(() => loadConfig({ SMS_ENV: "local", TRUST_PROXY: "yes" }, noFiles), /TRUST_PROXY must be true or false/);
  });
});

describe("staging and production", () => {
  test("a complete configuration loads, and the password is a Secret", () => {
    const config = loadConfig(STAGING, files({ "/run/secrets/db": "s3cret-value\n" }));
    assert.equal(config.database.host, "postgres");
    assert.equal(config.database.password?.reveal(), "s3cret-value");
  });
  test("there are no defaults for the database", () => {
    assert.deepEqual(problems({ SMS_ENV: "production" }), [
      "DATABASE_HOST is required when SMS_ENV is production",
      "DATABASE_PASSWORD_FILE is required when SMS_ENV is production",
    ]);
  });
  test("a missing or unreadable password file stops the start", () => {
    assert.deepEqual(problems(STAGING), ["DATABASE_PASSWORD_FILE cannot be read (check the path and the permissions)"]);
  });
  test("an empty password file stops the start", () => {
    assert.deepEqual(problems(STAGING, files({ "/run/secrets/db": "\n" })), ["DATABASE_PASSWORD_FILE points to an empty file"]);
  });
  test("a password given directly in the environment is refused", () => {
    const found = problems({ ...STAGING, DATABASE_PASSWORD: "x" }, files({ "/run/secrets/db": "ok" }));
    assert.deepEqual(found, ["DATABASE_PASSWORD is not accepted: give the secret as a file with DATABASE_PASSWORD_FILE"]);
  });
});

describe("invalid settings", () => {
  test("SMS_ENV is required and must be known", () => {
    assert.deepEqual(problems({}), ["SMS_ENV is required"]);
    assert.match(problems({ SMS_ENV: "prod" })[0] ?? "", /SMS_ENV must be one of: local, test, staging, production/);
  });
  test("ports must be whole numbers in range", () => {
    for (const value of ["0", "70000", "abc", "1.5", "-1"]) {
      assert.match(problems({ SMS_ENV: "local", PORT: value })[0] ?? "", /PORT must be a whole number between 1 and 65535/, value);
    }
  });
  test("an empty variable counts as missing, not as zero", () => {
    assert.equal(loadConfig({ SMS_ENV: "local", PORT: "" }, noFiles).server.port, 3000);
    assert.equal(loadConfig({ SMS_ENV: "local", PORT: "  " }, noFiles).server.port, 3000);
  });
  test("an unknown log level is refused", () => {
    assert.match(problems({ SMS_ENV: "local", LOG_LEVEL: "verbose" })[0] ?? "", /LOG_LEVEL must be one of/);
  });
  test("all problems are reported together", () => {
    const found = problems({ SMS_ENV: "local", PORT: "x", DATABASE_PORT: "y", LOG_LEVEL: "z" });
    assert.equal(found.length, 3);
  });
  test("a message never contains the value that was wrong", () => {
    const text = problems({ SMS_ENV: "staging-with-secret-token-abc123", PORT: "token-xyz-789", LOG_LEVEL: "hunter2" }).join("\n");
    for (const leaked of ["abc123", "xyz-789", "hunter2"]) assert.ok(!text.includes(leaked), leaked);
  });
});

describe("the result", () => {
  test("is frozen", () => {
    const config = loadConfig({ SMS_ENV: "local" }, noFiles);
    assert.ok(Object.isFrozen(config));
    assert.ok(Object.isFrozen(config.server));
    assert.ok(Object.isFrozen(config.database));
    assert.throws(() => {
      (config.server as { port: number }).port = 1;
    }, TypeError);
  });
  test("cannot leak the password through logging", () => {
    const config = loadConfig(STAGING, files({ "/run/secrets/db": "hunter2-secret" }));
    for (const text of [
      JSON.stringify(config),
      String(config.database.password),
      inspect(config, { depth: 5 }),
      // The template literal is the point of the test: it must not reveal the password either.
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      `${config.database.password}`,
    ]) {
      assert.ok(!text.includes("hunter2-secret"));
    }
    assert.ok(JSON.stringify(config).includes("[redacted]"));
  });
});

test("Secret hides its value everywhere but reveal()", () => {
  const secret = new Secret("abc");
  assert.equal(secret.reveal(), "abc");
  // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- what a template does with a Secret is the point of the test
  assert.equal(`${secret}`, "[redacted]");
  assert.equal(JSON.stringify({ secret }), '{"secret":"[redacted]"}');
  assert.equal(inspect(secret), "[redacted]");
});
