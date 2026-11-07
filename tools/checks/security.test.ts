import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { checkSecurity } from "./security.ts";
import { createProject, type Project } from "../test-support/project.ts";

let project: Project | undefined;
afterEach(() => {
  project?.cleanup();
  project = undefined;
});

const KERNEL = "apps/core-api/src/kernel/x.ts";

function run(files: Record<string, string>) {
  project = createProject(files);
  return checkSecurity(project.root);
}
const rules = (code: string, file = KERNEL): string[] =>
  run({ [file]: code })
    .findings.filter((item) => item.severity === "error")
    .map((item) => item.rule);

test("clean code passes", () => {
  assert.deepEqual(
    rules(
      'import { createHash } from "node:crypto";\nexport const h = createHash("sha256").update("a").digest("hex");\nexport const q = { text: "select 1 where id = $1", values: [1] };\n',
    ),
    [],
  );
});

describe("violations", () => {
  const cases: [string, string, string][] = [
    [
      "a query built with a template",
      "sql-interpolation",
      "declare const db: { query(text: string): void };\nexport const f = (id: string) => db.query(`select * from t where id = '${id}'`);\n",
    ],
    [
      "a query built with +",
      "sql-interpolation",
      'declare const db: { query(text: string): void };\nexport const f = (id: string) => db.query("select * from t where id = " + id);\n',
    ],
    [
      "unsafe raw text",
      "sql-interpolation",
      "declare const sql: { unsafe(text: string): void };\nexport const f = (c: string) => sql.unsafe(`order by ${c}`);\n",
    ],
    ["md5", "weak-hash", 'import { createHash } from "node:crypto";\nexport const h = createHash("MD5");\n'],
    ["sha1", "weak-hash", 'import { createHash } from "node:crypto";\nexport const h = createHash("sha1");\n'],
    ["hmac with md5", "weak-hash", 'import { createHmac } from "node:crypto";\nexport const h = createHmac("md5", "k");\n'],
    ["createCipher", "weak-cipher", 'import { createCipher } from "node:crypto";\nexport const c = createCipher("aes192", "k");\n'],
    [
      "an ECB cipher",
      "weak-cipher",
      'import { createCipheriv } from "node:crypto";\nexport const c = createCipheriv("aes-256-ecb", Buffer.alloc(32), null);\n',
    ],
    ["a regular expression from a variable", "dynamic-regexp", "export const r = (s: string) => new RegExp(s);\n"],
    ["certificate checking off", "tls-verification-off", "export const o = { rejectUnauthorized: false };\n"],
    ["the TLS environment switch", "tls-verification-off", 'export const n = "NODE_TLS_REJECT_UNAUTHORIZED";\n'],
    ["a cookie without httpOnly", "cookie-flags", "export const c = { httpOnly: false };\n"],
    ["a cookie without secure", "cookie-flags", "export const c = { secure: false };\n"],
    ["open CORS", "cors-open", 'export const c = { origin: "*" };\n'],
    ["CORS that reflects every origin", "cors-open", "export const c = { origin: true };\n"],
    ["a plain HTTP address", "insecure-url", 'export const u = "http://api.example.cm/v1";\n'],
  ];
  for (const [name, rule, code] of cases) {
    test(name, () => {
      assert.deepEqual(rules(code), [rule]);
    });
  }
});

describe("allowed patterns", () => {
  const cases: [string, string][] = [
    [
      "a constant query text",
      'declare const db: { query(text: string, v: unknown[]): void };\nexport const f = (id: string) => db.query("select * from t where id = $1", [id]);\n',
    ],
    ["text joined from literals", 'declare const db: { query(text: string): void };\nexport const f = () => db.query("select " + "1");\n'],
    ["a regular expression literal", "export const r = /^a+$/;\n"],
    ["a regular expression from a literal", 'export const r = new RegExp("^a+$");\n'],
    ["a local plain HTTP address", 'export const u = "http://localhost:3000";\n'],
    ["an XML namespace", 'export const u = "http://www.w3.org/2000/svg";\n'],
    ["secure cookies", "export const c = { httpOnly: true, secure: true };\n"],
    ["a listed origin", 'export const c = { origin: "https://staff.example.cm" };\n'],
  ];
  for (const [name, code] of cases) {
    test(name, () => {
      assert.deepEqual(rules(code), []);
    });
  }

  test("test files and tools are out of scope", () => {
    assert.deepEqual(rules("export const o = { rejectUnauthorized: false };\n", "apps/core-api/src/kernel/x.test.ts"), []);
    assert.deepEqual(rules("export const o = { rejectUnauthorized: false };\n", "tools/x.ts"), []);
  });
});

describe("exceptions", () => {
  test("a written exception removes the finding and is listed", () => {
    const result = run({
      [KERNEL]:
        "// security-ignore: tls-verification-off -- local test double, never deployed\nexport const o = { rejectUnauthorized: false };\n",
    });
    assert.deepEqual(result.findings, []);
    assert.deepEqual(
      result.suppressions.map((item) => item.rule),
      ["tls-verification-off"],
    );
  });

  test("an exception without a reason is a finding and removes nothing", () => {
    const found = run({ [KERNEL]: "// security-ignore: tls-verification-off\nexport const o = { rejectUnauthorized: false };\n" })
      .findings.map((item) => item.rule)
      .sort();
    assert.deepEqual(found, ["suppression-reason", "tls-verification-off"]);
  });

  test("an exception that matches nothing is a warning", () => {
    const found = run({ [KERNEL]: "// security-ignore: cors-open -- nothing to ignore here at all\nexport const a = 1;\n" }).findings;
    assert.deepEqual(
      found.map((item) => [item.rule, item.severity]),
      [["unused-suppression", "warning"]],
    );
  });
});

test("the API rules also read components of the web applications", () => {
  const findings = run({
    "apps/staff-web/src/page.tsx":
      'import { createHash } from "node:crypto";\nexport const h = createHash("md5");\nexport const P = () => <p>{h.toString()}</p>;\n',
  }).findings;
  assert.deepEqual(
    findings.map((item) => item.rule),
    ["weak-hash"],
  );
});
