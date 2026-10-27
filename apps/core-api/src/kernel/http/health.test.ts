import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import type { Server } from "node:http";
import { createHealthServer } from "./health.ts";

let server: Server;
let base = "";

before(async () => {
  server = createHealthServer({ version: "abc123" });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("health endpoint", () => {
  test("answers with the status and the version of the build", async () => {
    const response = await fetch(`${base}/health`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/json");
    assert.deepEqual(await response.json(), { status: "ok", service: "core-api", version: "abc123" });
  });

  test("the answer contains the version as the deploy script looks for it", async () => {
    const text = await (await fetch(`${base}/health`)).text();
    assert.ok(text.includes('"version":"abc123"'));
  });

  test("ignores a query string", async () => {
    assert.equal((await fetch(`${base}/health?probe=1`)).status, 200);
  });

  test("a HEAD request has headers and no body", async () => {
    const response = await fetch(`${base}/health`, { method: "HEAD" });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "");
  });

  test("never lets a client or proxy keep the answer", async () => {
    const response = await fetch(`${base}/health`);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  });

  test("other paths are not found", async () => {
    assert.equal((await fetch(`${base}/`)).status, 404);
    assert.equal((await fetch(`${base}/admin`)).status, 404);
  });

  test("other methods are refused", async () => {
    const response = await fetch(`${base}/health`, { method: "POST", body: "x" });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "GET, HEAD");
  });
});
