import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { checkDependencies } from "./dependencies.ts";
import { createProject, FIXTURE_JSON, type Project } from "../test-support/project.ts";

let project: Project | undefined;
afterEach(() => {
  project?.cleanup();
  project = undefined;
});

const NPMRC = "save-exact=true\nignore-scripts=true\nengine-strict=true\n";
const TODAY = new Date("2026-10-26T12:00:00Z");

const lock = (packages: Record<string, unknown>): string =>
  FIXTURE_JSON({ lockfileVersion: 3, packages: { "": { name: "fixture" }, ...packages } });
const GOOD_LOCK = lock({
  "node_modules/typescript": {
    version: "6.0.3",
    resolved: "https://registry.npmjs.org/typescript/-/typescript-6.0.3.tgz",
    integrity: "sha512-abc",
  },
});

function run(files: Record<string, string>) {
  project = createProject({ ".npmrc": NPMRC, "package-lock.json": GOOD_LOCK, ...files });
  return checkDependencies(project.root, TODAY).findings.map((item) => `${item.severity}:${item.rule}`);
}

test("a pinned project with a sound lock file passes", () => {
  assert.deepEqual(run({}), []);
});

describe("manifests", () => {
  const manifest = (dependencies: Record<string, string>): Record<string, string> => ({
    "apps/core-api/package.json": FIXTURE_JSON({ name: "@minesup/core-api", dependencies: { "@minesup/contracts": "*", ...dependencies } }),
  });

  test("a range is reported", () => {
    assert.deepEqual(run(manifest({ zod: "^3.0.0" })), ["error:dependency-not-exact"]);
    assert.deepEqual(run(manifest({ zod: "latest" })), ["error:dependency-not-exact"]);
  });

  test("an exact version and a pre-release pass", () => {
    assert.deepEqual(run(manifest({ zod: "3.25.1", other: "1.0.0-rc.1" })), []);
  });

  test("a star is allowed only for packages of this repository", () => {
    assert.deepEqual(run(manifest({ zod: "*" })), ["error:dependency-not-exact"]);
  });

  test("a git, URL, file or alias source is reported", () => {
    for (const spec of [
      "git+https://github.com/a/b.git",
      "github:a/b",
      "a/b",
      "https://example.com/x.tgz",
      "file:../x",
      "npm:other@1.0.0",
    ]) {
      assert.deepEqual(run(manifest({ zod: spec })), ["error:dependency-source"], spec);
    }
  });

  test("an unreadable manifest is reported", () => {
    assert.deepEqual(run({ "apps/core-api/package.json": "{" }), ["error:dependency-manifest"]);
  });
});

describe(".npmrc", () => {
  test("a missing file is reported", () => {
    project = createProject();
    project.remove(".npmrc");
    assert.deepEqual(
      checkDependencies(project.root, TODAY).findings.map((item) => item.rule),
      ["npmrc-policy"],
    );
  });

  test("each missing setting is reported", () => {
    assert.deepEqual(run({ ".npmrc": "engine-strict=true\n" }), ["error:npmrc-policy", "error:npmrc-policy"]);
  });
});

describe("lock file", () => {
  test("a missing lock file is a warning", () => {
    project = createProject();
    project.remove("package-lock.json");
    assert.deepEqual(
      checkDependencies(project.root, TODAY).findings.map((item) => `${item.severity}:${item.rule}`),
      ["warning:lockfile-missing"],
    );
  });

  test("a package fetched from elsewhere is reported", () => {
    const found = run({
      "package-lock.json": lock({ "node_modules/x": { resolved: "https://evil.example.com/x.tgz", integrity: "sha512-abc" } }),
    });
    assert.deepEqual(found, ["error:lockfile-source"]);
  });

  test("a package without an integrity hash is reported", () => {
    const found = run({ "package-lock.json": lock({ "node_modules/x": { resolved: "https://registry.npmjs.org/x/-/x-1.0.0.tgz" } }) });
    assert.deepEqual(found, ["error:lockfile-integrity"]);
  });

  test("workspace links and the root are skipped", () => {
    assert.deepEqual(
      run({ "package-lock.json": lock({ "node_modules/@minesup/contracts": { resolved: "packages/contracts", link: true } }) }),
      [],
    );
  });

  test("a lock file in the wrong format is reported", () => {
    assert.deepEqual(run({ "package-lock.json": "{}" }), ["error:lockfile-format"]);
  });

  test("no more than five findings per rule", () => {
    const many: Record<string, unknown> = {};
    for (let index = 0; index < 20; index += 1)
      many[`node_modules/p${index}`] = { resolved: "https://evil.example.com/p.tgz", integrity: "sha512-abc" };
    assert.equal(run({ "package-lock.json": lock(many) }).length, 5);
  });
});

describe("accepted risks", () => {
  const file = (entries: unknown[]): Record<string, string> => ({ "security/accepted-risks.json": FIXTURE_JSON({ accepted: entries }) });
  const entry = { id: "GHSA-aaaa-bbbb-cccc", reason: "Only reachable by staff, input is validated upstream.", expires: "2026-12-01" };

  test("a valid entry passes", () => {
    assert.deepEqual(run(file([entry])), []);
  });

  test("an expired entry is reported", () => {
    assert.deepEqual(run(file([{ ...entry, expires: "2026-10-01" }])), ["error:accepted-risk"]);
  });

  test("an expiry date more than 90 days away is reported", () => {
    assert.deepEqual(run(file([{ ...entry, expires: "2027-06-01" }])), ["error:accepted-risk"]);
  });

  test("a short reason, a missing id, a bad date and a duplicate are reported", () => {
    assert.equal(run(file([{ ...entry, reason: "ok" }, { ...entry, id: "" }, { ...entry, expires: "tomorrow" }, entry, entry])).length, 4);
  });

  test("a file that is not JSON, or has the wrong shape, is reported", () => {
    assert.deepEqual(run({ "security/accepted-risks.json": "{" }), ["error:accepted-risk"]);
    assert.deepEqual(run({ "security/accepted-risks.json": "[]" }), ["error:accepted-risk"]);
  });
});
