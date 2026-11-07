import assert from "node:assert/strict";
import { test } from "node:test";
import { findPrettyPrinter, wantsPrettyLogs } from "./dev-pretty.ts";

const found = (manifest: string) => ({ resolve: () => "/x/node_modules/pino-pretty/package.json", read: () => manifest });

test("finds the program of the library from its manifest", () => {
  assert.equal(findPrettyPrinter(found('{"bin":{"pino-pretty":"./bin.js"}}'))?.replaceAll("\\", "/"), "/x/node_modules/pino-pretty/bin.js");
  assert.equal(findPrettyPrinter(found('{"bin":"cli.js"}'))?.replaceAll("\\", "/"), "/x/node_modules/pino-pretty/cli.js");
});

test("a library that is not installed, or a manifest that cannot be used, means plain logs", () => {
  const missing = {
    resolve: (): string => {
      throw new Error("MODULE_NOT_FOUND");
    },
    read: (): string => "",
  };
  assert.equal(findPrettyPrinter(missing), undefined);
  assert.equal(findPrettyPrinter(found("{}")), undefined);
  assert.equal(findPrettyPrinter(found("not json")), undefined);
});

test("readable logs can be turned off", () => {
  assert.equal(wantsPrettyLogs({}), true);
  assert.equal(wantsPrettyLogs({ SMS_LOG_PRETTY: "off" }), false);
});
