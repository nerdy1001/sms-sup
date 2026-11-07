import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { z } from "zod";
import { describeApi } from "../apps/core-api/src/kernel/http/api-description.ts";
import type { ModuleRoutes } from "../apps/core-api/src/kernel/http/server.ts";
import { currentDescription, OPENAPI_PATH } from "./api-docs.ts";

interface Operation {
  readonly "x-access"?: unknown;
  readonly responses?: Record<string, { content?: Record<string, unknown> }>;
}
interface Description {
  readonly openapi: string;
  readonly paths: Record<string, Record<string, Operation>>;
}

const fakeModule: ModuleRoutes = () => async (app) => {
  app.get(
    "/scholars/:id",
    {
      config: { access: ["administrator", "auditor"] },
      schema: { params: z.object({ id: z.string() }), response: { 200: z.object({ id: z.string() }) } },
    },
    (request) => ({ id: request.params.id }),
  );
};

describe("the API description", () => {
  test("the committed file is up to date (if not: run npm run api:docs)", async () => {
    const committed = readFileSync(join(import.meta.dirname, "..", OPENAPI_PATH), "utf8").replaceAll("\r\n", "\n");
    assert.equal(
      committed,
      await currentDescription(),
      "docs/api/openapi.json is out of date. Run `npm run api:docs` and commit the result.",
    );
  });

  test("building it twice gives the same text, so the file does not change without a reason", async () => {
    assert.equal(await describeApi([fakeModule]), await describeApi([fakeModule]));
  });

  test("covers the operations routes and every route of every module", async () => {
    const description = JSON.parse(await describeApi([fakeModule])) as Description;
    assert.equal(description.openapi, "3.1.0");
    assert.ok(description.paths["/health"]?.["get"]);
    assert.ok(description.paths["/ready"]?.["get"]);
    assert.ok(description.paths["/api/scholars/{id}"]?.["get"]);
  });

  test("every operation says who may call it and how it fails", async () => {
    const description = JSON.parse(await describeApi([fakeModule])) as Description;
    for (const [path, methods] of Object.entries(description.paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        assert.ok(operation["x-access"] !== undefined, `${method} ${path} has no access`);
        assert.ok(operation.responses?.["default"]?.content?.["application/problem+json"], `${method} ${path} has no error answer`);
      }
    }
    assert.deepEqual(description.paths["/api/scholars/{id}"]?.["get"]?.["x-access"], ["administrator", "auditor"]);
    assert.equal(description.paths["/health"]?.["get"]?.["x-access"], "public");
  });
});
