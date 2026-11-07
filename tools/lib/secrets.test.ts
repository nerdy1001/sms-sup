import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { checkFileName, entropy, mask, scanDiff, scanLine, scanText } from "./secrets.ts";

// Fake secrets are assembled from pieces so that this file does not trip the scanner it tests.
const AWS = "AK" + "IA" + "ABCDEFGHIJKLMNOP";
const GITHUB = "ghp" + "_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8";
const SLACK_TOKEN = "xo" + "xb-" + "1234567890-abcdefghij";
const WEBHOOK = "https://hooks." + "slack.com/services/T0000000/B0000000/abcdefghijklmnop1234";
const GOOGLE = "AI" + "za" + "SyA1234567890abcdefghijklmnopqrstuv";
const STRIPE = "sk_" + "live_" + "abcdefghijklmnop1234";
const NPM = "npm" + "_" + "abcdefghijklmnopqrstuvwxyz0123456789";
const JWT = "ey" + "JhbGciOiJIUzI1NiJ9." + "ey" + "JzdWIiOiIxMjM0NTY3ODkwIn0." + "abcdefghijklmnop";
const PRIVATE_KEY = "-----BEGIN " + "RSA PRIVATE KEY-----";

describe("detectors", () => {
  const cases: [string, string, string][] = [
    ["private key", `${PRIVATE_KEY}`, "private-key"],
    ["AWS access key", `const key = "${AWS}";`, "aws-access-key"],
    ["GitHub token", `token ${GITHUB}`, "github-token"],
    ["Slack token", SLACK_TOKEN, "slack-token"],
    ["Slack webhook", WEBHOOK, "slack-webhook"],
    ["Google API key", GOOGLE, "google-api-key"],
    ["Stripe live key", STRIPE, "stripe-key"],
    ["npm token", NPM, "npm-token"],
    ["JWT", `Authorization: Bearer ${JWT}`, "jwt"],
    ["password in a connection address", "postgres://app:" + "Zk3v9Qp2Lm8x" + "@db.internal:5432/sms", "credential-url"],
    ["keyword assignment", 'const apiKey = "' + "q8Zk3vP9Lm2xW7nR" + '";', "secret-assignment"],
    ["keyword in JSON", '"client_secret": "' + "aB3dE5gH7jK9mN1p" + '"', "secret-assignment"],
  ];
  for (const [name, line, rule] of cases) {
    test(`finds ${name}`, () => {
      assert.deepEqual(
        scanLine(line).map((hit) => hit.rule),
        [rule],
      );
    });
  }

  const harmless = [
    "const a = 1;",
    "postgres://app:password@localhost/sms",
    "postgres://app:${DB_PASSWORD}@db/sms",
    "postgres://app:<password>@db/sms",
    'const password = "changeme-please-123";',
    "const token = process.env.TOKEN_VALUE_1;",
    'const secretName = "scholar-registry-export";',
    'const authHeader = "Authorization";',
    'password: "${PASSWORD_FROM_VAULT}"',
    "const x = 'abcdefghijklmnop';",
    'const apiKey = "aaaaaaaaaaaaaaaa1";',
  ];
  for (const line of harmless) {
    test(`ignores: ${line}`, () => {
      assert.deepEqual(scanLine(line), []);
    });
  }

  test("a report shows a masked preview, never the secret", () => {
    const [hit] = scanLine(`const key = "${AWS}";`);
    assert.equal(hit?.preview, mask(AWS));
    assert.ok(!(hit?.preview ?? "").includes(AWS));
  });
});

test("entropy separates random text from words", () => {
  assert.ok(entropy("q8Zk3vP9Lm2xW7nR") > 3.5);
  assert.ok(entropy("aaaaaaaaaaaa") < 1);
  assert.equal(entropy(""), 0);
});

describe("scanText and allow markers", () => {
  const line = `const key = "${AWS}";`;

  test("reports the line number", () => {
    assert.deepEqual(
      scanText(`a\nb\n${line}\n`).hits.map((item) => item.line),
      [3],
    );
  });

  test("a marker with a rule and a reason on the same line allows the hit", () => {
    const scan = scanText(`${line} // secrets-allow: aws-access-key -- documented example from the vendor guide`);
    assert.deepEqual(scan.hits, []);
    assert.equal(scan.allowed.length, 1);
  });

  test("a marker on the line before allows the hit", () => {
    const scan = scanText(`// secrets-allow: aws-access-key -- documented example from the vendor guide\n${line}\n`);
    assert.deepEqual(scan.hits, []);
  });

  test("a marker for another rule, or with a short reason, allows nothing", () => {
    assert.equal(scanText(`${line} // secrets-allow: jwt -- documented example from the vendor guide`).hits.length, 1);
    assert.equal(scanText(`${line} // secrets-allow: aws-access-key -- example`).hits.length, 1);
  });

  test("a marker two lines before does not reach", () => {
    assert.equal(scanText(`// secrets-allow: aws-access-key -- documented example from the vendor guide\n\n${line}\n`).hits.length, 1);
  });
});

describe("history", () => {
  const head = "commit 0123456789abcdef0123456789abcdef01234567\n\ndiff --git a/src/a.ts b/src/a.ts\n--- /dev/null\n+++ b/src/a.ts\n";

  test("finds a secret in an added line, with commit, file and line number", () => {
    const diff = `${head}@@ -0,0 +1,3 @@\n+one\n+two\n+const key = "${AWS}";\n`;
    const [hit] = scanDiff(diff);
    assert.equal(hit?.commit, "0123456");
    assert.equal(hit?.file, "src/a.ts");
    assert.equal(hit?.line, 3);
    assert.equal(hit?.hit.rule, "aws-access-key");
  });

  test("a secret that was removed again is still found where it was added", () => {
    const added = `${head}@@ -0,0 +1 @@\n+const key = "${AWS}";\n`;
    const removed =
      'commit fedcba9876543210fedcba9876543210fedcba98\n\ndiff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +0,0 @@\n-const key = "' +
      AWS +
      '";\n';
    assert.deepEqual(
      scanDiff(`${removed}\n${added}`).map((item) => item.commit),
      ["0123456"],
    );
  });

  test("removed and context lines are not reported, headers are not content", () => {
    const diff = `${head}@@ -1,2 +1,2 @@\n context ${AWS}\n-old ${AWS}\n+new line\n`;
    assert.deepEqual(scanDiff(diff), []);
  });

  test("a line that starts with ++ is content, not a header", () => {
    const diff = `${head}@@ -0,0 +1 @@\n+++ ${AWS}\n`;
    assert.equal(scanDiff(diff).length, 1);
  });

  test("an allow marker in the added line is honoured", () => {
    const diff = `${head}@@ -0,0 +1 @@\n+const key = "${AWS}"; // secrets-allow: aws-access-key -- documented vendor example\n`;
    assert.deepEqual(scanDiff(diff), []);
  });
});

describe("file names", () => {
  const cases: [string, string | undefined, string?][] = [
    [".env", "secret-file"],
    ["apps/core-api/.env.production", "secret-file"],
    [".env.example", undefined],
    ["certs/server.pem", "secret-file"],
    ["deploy/id_ed25519", "secret-file"],
    ["exports/scholars.xlsx", "data-file"],
    ["backup.sqlite3", "data-file"],
    ["fixtures/synthetic.csv", "data-file", "warning"],
    ["src/environment.ts", undefined],
  ];
  for (const [path, rule, severity] of cases) {
    test(path, () => {
      const result = checkFileName(path);
      assert.equal(result?.rule, rule);
      if (severity !== undefined) assert.equal(result?.severity, severity);
    });
  }
});
