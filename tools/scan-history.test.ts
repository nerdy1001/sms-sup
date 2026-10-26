import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { findingsFromHistory, historyId } from "./scan-history.ts";

const AWS = "AK" + "IA" + "ABCDEFGHIJKLMNOP";
const DIFF = `commit 0123456789abcdef0123456789abcdef01234567\n\ndiff --git a/src/a.ts b/src/a.ts\n--- /dev/null\n+++ b/src/a.ts\n@@ -0,0 +1 @@\n+const key = "${AWS}";\n`;

describe("findingsFromHistory", () => {
  test("reports a secret with its commit and tells the reader to rotate it", () => {
    const [item] = findingsFromHistory(DIFF, [], new Set());
    assert.equal(item?.rule, "secret-aws-access-key");
    assert.equal(item?.file, "src/a.ts");
    assert.match(item?.message ?? "", /0123456/);
    assert.match(item?.message ?? "", /Rotate it now/);
    assert.ok(!(item?.message ?? "").includes(AWS));
  });

  test("an accepted id removes the finding", () => {
    assert.deepEqual(findingsFromHistory(DIFF, [], new Set([historyId("0123456", "src/a.ts", "aws-access-key")])), []);
  });

  test("a secret file name that was ever added is reported once", () => {
    const found = findingsFromHistory("", [".env", ".env", "src/a.ts"], new Set());
    assert.deepEqual(found.map((item) => [item.rule, item.file]), [["secret-file", ".env"]]);
  });

  test("a warning-level file name is not reported from history", () => {
    assert.deepEqual(findingsFromHistory("", ["fixtures/a.csv"], new Set()), []);
  });

  test("an accepted file name is skipped", () => {
    assert.deepEqual(findingsFromHistory("", [".env"], new Set(["secret-file:.env"])), []);
  });

  test("a clean history has no findings", () => {
    assert.deepEqual(findingsFromHistory("commit 0123456789abcdef0123456789abcdef01234567\n\n", ["README.md"], new Set()), []);
  });
});
