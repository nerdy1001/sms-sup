import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSource, scanImports } from "./imports.ts";

const scan = (code: string) => scanImports(parseSource("x.ts", code));

test("finds static, type-only, re-export and dynamic imports", () => {
  const { imports, computed } = scan(
    [
      'import a from "./a.ts";',
      'import type { B } from "./b.ts";',
      'import { type C, d } from "./c.ts";',
      'export * from "./e.ts";',
      'export type { F } from "./f.ts";',
      'const g = await import("./g.ts");',
      'type H = import("./h.ts").H;',
    ].join("\n"),
  );
  assert.deepEqual(
    imports.map((item) => [item.specifier, item.typeOnly]),
    [
      ["./a.ts", false],
      ["./b.ts", true],
      ["./c.ts", false],
      ["./e.ts", false],
      ["./f.ts", true],
      ["./g.ts", false],
      ["./h.ts", true],
    ],
  );
  assert.equal(computed.length, 0);
});

test("reports computed dynamic imports and require calls", () => {
  const { imports, computed } = scan('const name = "x";\nawait import(name);\nconst y = require("./y.ts");\nrequire(name);');
  assert.deepEqual(
    imports.map((item) => [item.specifier, item.kind]),
    [["./y.ts", "require"]],
  );
  assert.deepEqual(
    computed.map((item) => [item.kind, item.line]),
    [
      ["dynamic", 2],
      ["require", 4],
    ],
  );
});

test("does not mistake text in strings or comments for imports", () => {
  const { imports } = scan('const s = \'import x from "./nope.ts"\';\n// import y from "./nope2.ts";\n');
  assert.equal(imports.length, 0);
});
