import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { checkStandards } from "./standards.ts";
import { createProject, type Project } from "../test-support/project.ts";

let project: Project | undefined;
afterEach(() => {
  project?.cleanup();
  project = undefined;
});

const KERNEL = "apps/core-api/src/kernel/x.ts";

function run(files: Record<string, string>) {
  project = createProject(files);
  return checkStandards(project.root);
}
const errorRules = (files: Record<string, string>): string[] =>
  run(files)
    .findings.filter((item) => item.severity === "error")
    .map((item) => item.rule);

test("clean code passes", () => {
  assert.deepEqual(
    errorRules({ [KERNEL]: "export const a = 1;\nexport function f(value: unknown): string {\n  return String(value);\n}\n" }),
    [],
  );
});

const violations: { name: string; rule: string; code: string; file?: string }[] = [
  { name: "any", rule: "no-any", code: "export const a: any = 1;\n" },
  { name: "non-null assertion", rule: "no-non-null", code: 'const m = new Map<string, string>();\nexport const v = m.get("a")!;\n' },
  { name: "default export of a value", rule: "no-default-export", code: "export default 1;\n" },
  { name: "default export of a function", rule: "no-default-export", code: "export default function f() {}\n" },
  { name: "default export by renaming", rule: "no-default-export", code: "const a = 1;\nexport { a as default };\n" },
  { name: "console", rule: "no-console", code: 'console.log("x");\n' },
  { name: "eval", rule: "no-eval", code: 'eval("1");\n' },
  { name: "new Function", rule: "no-eval", code: 'export const f = new Function("return 1");\n' },
  { name: "timer with a string", rule: "no-eval", code: 'setTimeout("run()", 10);\n' },
  { name: "process.env in application code", rule: "no-process-env", code: "export const v = process.env.SECRET;\n" },
  { name: "process[env]", rule: "no-process-env", code: 'export const v = process["env"];\n' },
  { name: "toFixed", rule: "no-float-money", code: "export const v = (1.5).toFixed(2);\n" },
  { name: "parseFloat", rule: "no-float-money", code: 'export const v = parseFloat("1.5");\n' },
  { name: "Number.parseFloat", rule: "no-float-money", code: 'export const v = Number.parseFloat("1.5");\n' },
  { name: "Math.random", rule: "no-math-random", code: "export const v = Math.random();\n" },
  {
    name: "fetch in a business module",
    rule: "network-egress",
    code: 'await fetch("https://x");\n',
    file: "apps/core-api/src/modules/registry/internal/application/a.ts",
  },
  { name: "globalThis.fetch", rule: "network-egress", code: 'await globalThis.fetch("https://x");\n' },
  { name: "WebSocket", rule: "network-egress", code: 'export const w = new WebSocket("wss://x");\n' },
  { name: "ts-ignore comment", rule: "no-ts-ignore", code: "// @ts-ignore\nexport const a: number = 'x';\n" },
  { name: "ts-nocheck comment", rule: "no-ts-ignore", code: "/* @ts-nocheck */\nexport const a = 1;\n" },
  { name: "expect-error without a reason", rule: "no-ts-ignore", code: "// @ts-expect-error\nexport const a: number = 'x';\n" },
];

describe("violations are reported", () => {
  for (const item of violations) {
    test(item.name, () => {
      const rules = errorRules({ [item.file ?? KERNEL]: item.code });
      assert.ok(rules.includes(item.rule), `expected ${item.rule}, got [${rules.join(", ")}]`);
    });
  }
});

describe("allowed uses", () => {
  test("configuration may read the environment, in its own folder and in main.ts", () => {
    assert.deepEqual(
      errorRules({
        "apps/core-api/src/kernel/config/env.ts": "export const v = process.env.X;\n",
        "apps/core-api/src/main.ts": "export const w = process.env.Y;\n",
      }),
      [],
    );
  });

  test("network globals are allowed in the places that may use the network", () => {
    assert.deepEqual(
      errorRules({
        "apps/core-api/src/modules/sync/internal/infrastructure/c.ts": 'export const r = await fetch("https://x");\n',
        "apps/core-api/src/kernel/net/n.ts": 'export const r = await fetch("https://y");\n',
        "apps/staff-web/src/api.ts": 'export const r = await fetch("/api");\n',
      }),
      [],
    );
  });

  test("an expect-error directive with a reason is accepted", () => {
    assert.deepEqual(
      errorRules({
        [KERNEL]: "// @ts-expect-error the library types are wrong for this call, see issue 12\nexport const a: number = 'x';\n",
      }),
      [],
    );
  });

  test("tests and tools may use console, process.env and toFixed", () => {
    assert.deepEqual(
      errorRules({
        "apps/core-api/src/kernel/x.test.ts": "console.log(process.env.X, (1).toFixed(1));\n",
        "tools/script.ts": 'console.log("hello");\n',
      }),
      [],
    );
  });

  test("tests are still held to the type rules", () => {
    assert.ok(errorRules({ "apps/core-api/src/kernel/x.test.ts": "export const a: any = 1;\n" }).includes("no-any"));
  });

  test("words in strings or comments are not mistaken for code", () => {
    assert.deepEqual(
      errorRules({ [KERNEL]: '// do not call console.log or eval( here\nexport const note = "use Math.random() never; any is banned";\n' }),
      [],
    );
  });
});

describe("suppressions", () => {
  test("a suppression with a reason silences one rule and stays visible in the report", () => {
    const result = run({
      [KERNEL]: "// standards-ignore: no-any -- the vendor library exposes an untyped callback\nexport const a: any = 1;\n",
    });
    assert.deepEqual(result.findings, []);
    assert.equal(result.suppressions.length, 1);
    assert.equal(result.suppressions[0]?.rule, "no-any");
  });

  test("a trailing suppression covers its own line", () => {
    const result = run({ [KERNEL]: "export const a: any = 1; // standards-ignore: no-any -- legacy shape, tracked in issue 42\n" });
    assert.deepEqual(result.findings, []);
  });

  test("a suppression without a reason is itself an error and does not silence anything", () => {
    const rules = errorRules({ [KERNEL]: "// standards-ignore: no-any\nexport const a: any = 1;\n" });
    assert.deepEqual(rules.sort(), ["no-any", "suppression-reason"]);
  });

  test("a suppression that matches nothing is a warning", () => {
    const result = run({ [KERNEL]: "// standards-ignore: no-any -- nothing to silence on the next line\nexport const a = 1;\n" });
    assert.deepEqual(
      result.findings.map((item) => [item.rule, item.severity]),
      [["unused-suppression", "warning"]],
    );
  });

  test("a suppression for another rule does not silence the finding", () => {
    const rules = errorRules({
      [KERNEL]: "// standards-ignore: no-console -- wrong rule named here on purpose\nexport const a: any = 1;\n",
    });
    assert.ok(rules.includes("no-any"));
  });
});

describe("whitespace", () => {
  const whitespace = (name: string, content: string): string[] =>
    run({ [name]: content })
      .findings.filter((item) => item.rule === "whitespace")
      .map((item) => item.message);

  test("clean text files pass", () => {
    assert.deepEqual(whitespace("docs/a.md", "# Title\n\nText.\n"), []);
  });
  test("tabs are reported", () => {
    assert.equal(whitespace("docs/a.md", "a\n\tb\n").length, 1);
  });
  test("trailing spaces are reported", () => {
    assert.equal(whitespace("docs/a.md", "a \nb\n").length, 1);
  });
  test("Windows line endings are reported", () => {
    assert.ok(whitespace("docs/a.json", "{}\r\n").some((message) => message.includes("CRLF")));
  });
  test("a missing final newline is reported", () => {
    assert.equal(whitespace("docs/a.md", "a").length, 1);
  });
  test("extra blank lines at the end are reported", () => {
    assert.equal(whitespace("docs/a.md", "a\n\n").length, 1);
  });
  test("the lock file is ignored", () => {
    assert.deepEqual(whitespace("package-lock.json", "{}"), []);
  });
});

describe("web applications (files with JSX)", () => {
  test("the coding rules apply to components too", () => {
    assert.deepEqual(errorRules({ "apps/staff-web/src/page.tsx": "export const Page = (p: { v: any }) => <p>{p.v}</p>;\n" }), ["no-any"]);
    assert.deepEqual(errorRules({ "apps/staff-web/src/page.tsx": "export default function Page() {\n  return <p>x</p>;\n}\n" }), [
      "no-default-export",
    ]);
    assert.deepEqual(errorRules({ "apps/staff-web/src/page.tsx": 'export const Page = () => { console.log("x"); return <p>x</p>; };\n' }), [
      "no-console",
    ]);
  });
  test("a clean component passes, and test files may log", () => {
    assert.deepEqual(errorRules({ "apps/staff-web/src/page.tsx": "export const Page = () => <p>x</p>;\n" }), []);
    assert.deepEqual(
      errorRules({ "apps/staff-web/src/page.spec.tsx": 'export const t = () => { console.log("x"); return <p>x</p>; };\n' }),
      [],
    );
  });
  test("whitespace rules apply to style sheets and pages", () => {
    const rules = (files: Record<string, string>): string[] => run(files).findings.map((item) => item.rule);
    assert.deepEqual(rules({ "apps/staff-web/src/styles.css": "body {} \n" }), ["whitespace"]);
    const page = rules({ "apps/staff-web/index.html": "<p>x</p>\t\n" });
    assert.ok(page.length > 0 && page.every((rule) => rule === "whitespace"));
  });
});
