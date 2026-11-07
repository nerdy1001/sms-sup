import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { checkWeb } from "./web.ts";
import { createProject, type Project } from "../test-support/project.ts";

let project: Project | undefined;
afterEach(() => {
  project?.cleanup();
  project = undefined;
});

const PAGE = "apps/staff-web/src/pages/x.tsx";
const API = "apps/staff-web/src/api/client.ts";

function run(files: Record<string, string>) {
  project = createProject(files);
  return checkWeb(project.root);
}
const rules = (code: string, file = PAGE): string[] => run({ [file]: code }).findings.map((item) => item.rule);

test("clean code passes", () => {
  assert.deepEqual(
    rules(
      'import { useState } from "react";\nexport function X() {\n  const [a] = useState(1);\n  return <a href="/x" target="_blank" rel="noopener noreferrer">{a}</a>;\n}\n',
    ),
    [],
  );
});

describe("violations", () => {
  const cases: [string, string, string][] = [
    ["localStorage", "web-browser-storage", 'export const read = () => localStorage.getItem("token");\n'],
    ["sessionStorage through window", "web-browser-storage", "export const read = () => window.sessionStorage.length;\n"],
    ["indexedDB", "web-browser-storage", "export const db = indexedDB;\n"],
    ["document.cookie", "web-browser-storage", "export const c = () => document.cookie;\n"],
    ["innerHTML", "web-raw-html", "export const f = (e: HTMLElement, v: string) => { e.innerHTML = v; };\n"],
    ["insertAdjacentHTML", "web-raw-html", 'export const f = (e: HTMLElement, v: string) => e.insertAdjacentHTML("beforeend", v);\n'],
    ["document.write", "web-raw-html", "export const f = (v: string) => document.write(v);\n"],
    [
      "dangerouslySetInnerHTML",
      "web-raw-html",
      "export const X = (p: { v: string }) => <div dangerouslySetInnerHTML={{ __html: p.v }} />;\n",
    ],
    ["eval", "web-raw-html", "export const f = (v: string) => eval(v);\n"],
    ["a call to the network from a page", "web-network-location", 'export const f = () => fetch("/health");\n'],
    ["a web socket from a page", "web-network-location", 'export const f = () => new WebSocket("wss://localhost/x");\n'],
    ["a Node module", "web-node-builtin", 'import { readFileSync } from "node:fs";\nexport const f = readFileSync;\n'],
    ["a Node module without the prefix", "web-node-builtin", 'import { join } from "path";\nexport const f = join;\n'],
    ["another website", "web-external-origin", 'export const url = "https://cdn.example.org/lib.js";\n'],
    ["plain http to another website", "web-external-origin", 'export const url = "http://tracker.example.org";\n'],
    ["a link that opens a tab without noopener", "web-target-blank", 'export const X = () => <a href="/x" target="_blank">x</a>;\n'],
    [
      "a link with only noreferrer text missing noopener",
      "web-target-blank",
      'export const X = () => <a href="/x" target="_blank" rel="external">x</a>;\n',
    ],
  ];
  for (const [name, rule, code] of cases) {
    test(name, () => {
      assert.ok(rules(code).includes(rule), `${rule} expected for: ${name}`);
    });
  }
});

describe("what is allowed", () => {
  test("the API folder may call the network", () => {
    assert.deepEqual(rules('export const f = () => fetch("/health");\n', API), []);
  });
  test("addresses on this computer and the XML namespace are not other websites", () => {
    assert.deepEqual(
      rules(
        'export const a = "http://localhost:3000";\nexport const b = "http://127.0.0.1:5173";\nexport const c = "http://www.w3.org/2000/svg";\n',
      ),
      [],
    );
  });
  test("tests may use anything", () => {
    assert.deepEqual(
      run({
        "apps/staff-web/src/pages/x.spec.tsx":
          'export const read = () => localStorage.getItem("a") + fetch("/x") + "https://example.org";\n',
      }).findings,
      [],
    );
    assert.deepEqual(
      run({ "apps/staff-web/src/test-support/render.tsx": 'export const read = () => localStorage.getItem("a");\n' }).findings,
      [],
    );
  });
  test("the API applications are not covered by these rules", () => {
    assert.deepEqual(run({ "apps/core-api/src/kernel/x.ts": 'export const url = "https://example.org";\n' }).findings, []);
  });
  test("declaring a name that looks like a browser feature is not a use of it (using it later is, by design)", () => {
    assert.deepEqual(rules("export const caches = [1];\n"), []);
    assert.ok(rules("const caches = [1];\nexport const n = caches.length;\n").includes("web-browser-storage"));
  });
  test("a written exception with a reason is allowed and stays visible", () => {
    const result = run({
      [PAGE]:
        '// web-ignore: web-external-origin -- the Ministry portal link, reviewed\nexport const url = "https://portal.example.org";\n',
    });
    assert.deepEqual(result.findings, []);
    assert.equal(result.suppressions.length, 1);
  });
  test("an exception without a reason is itself a finding", () => {
    const result = run({ [PAGE]: '// web-ignore: web-external-origin\nexport const url = "https://portal.example.org";\n' });
    assert.ok(result.findings.some((item) => item.rule === "suppression-reason"));
    assert.ok(result.findings.some((item) => item.rule === "web-external-origin"));
  });
});

describe("the page index.html", () => {
  const page = (body: string): string[] =>
    run({
      "apps/staff-web/index.html": `<!doctype html>\n<html>\n<head>\n${body}\n</head>\n<body><div id="root"></div></body>\n</html>\n`,
    }).findings.map((item) => item.rule);
  test("a page that loads its own script passes", () => {
    assert.deepEqual(page('<script type="module" src="/src/main.tsx"></script>'), []);
  });
  test("an inline script is refused", () => {
    assert.deepEqual(page("<script>alert(1)</script>"), ["web-html"]);
  });
  test("an inline style is refused", () => {
    assert.deepEqual(page("<style>body{}</style>"), ["web-html"]);
    assert.deepEqual(page('<meta name="x" style="color:red">'), ["web-html"]);
  });
  test("something loaded from another address is refused", () => {
    assert.deepEqual(page('<script src="https://cdn.example.org/a.js"></script>'), ["web-html"]);
    assert.deepEqual(page('<link rel="stylesheet" href="//fonts.example.org/a.css">'), ["web-html"]);
  });
  test("an event attribute is refused", () => {
    assert.deepEqual(page('<body onload="x()">'), ["web-html"]);
  });
});
