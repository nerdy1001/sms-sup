import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { evaluate, parseAudit, type Advisory } from "./audit.ts";

const advisory = (id: string, pkg: string, severity: Advisory["severity"]): Advisory => ({
  id,
  package: pkg,
  severity,
  title: "t",
  url: `https://github.com/advisories/${id}`,
});

const report = (vulnerabilities: unknown): string => JSON.stringify({ auditReportVersion: 2, vulnerabilities });

describe("parseAudit", () => {
  test("flattens advisories and ignores package names in via", () => {
    const text = report({
      lodash: {
        name: "lodash",
        via: [
          {
            source: 1,
            name: "lodash",
            title: "Prototype pollution",
            url: "https://github.com/advisories/GHSA-p6mc-m468-83gw",
            severity: "high",
          },
        ],
      },
      "uses-lodash": { name: "uses-lodash", via: ["lodash"] },
    });
    const parsed = parseAudit(text);
    assert.equal(parsed.error, undefined);
    assert.deepEqual(
      parsed.advisories.map((item) => [item.id, item.package, item.severity]),
      [["GHSA-P6MC-M468-83GW", "lodash", "high"]],
    );
  });

  test("the same advisory seen through two packages is listed once per package", () => {
    const via = { source: 1, name: "x", title: "t", url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc", severity: "low" };
    const parsed = parseAudit(report({ x: { name: "x", via: [via, via] }, y: { name: "y", via: [{ ...via, name: "y" }] } }));
    assert.equal(parsed.advisories.length, 2);
  });

  test("falls back to the numeric source when there is no advisory address", () => {
    const parsed = parseAudit(report({ x: { name: "x", via: [{ source: 1234, name: "x", title: "t", severity: "critical" }] } }));
    assert.equal(parsed.advisories[0]?.id, "1234");
  });

  test("an unknown severity is treated as moderate", () => {
    const parsed = parseAudit(report({ x: { name: "x", via: [{ source: 1, name: "x", severity: "weird" }] } }));
    assert.equal(parsed.advisories[0]?.severity, "moderate");
  });

  test("an empty report has no advisories and no error", () => {
    assert.deepEqual(parseAudit(report({})), { error: undefined, advisories: [] });
  });

  test("an npm error, bad JSON and a missing section all fail", () => {
    assert.match(parseAudit(JSON.stringify({ error: { code: "ENOTFOUND", summary: "request failed" } })).error ?? "", /request failed/);
    assert.match(parseAudit("<html>").error ?? "", /did not return JSON/);
    assert.match(parseAudit("{}").error ?? "", /no vulnerability section/);
  });
});

describe("evaluate", () => {
  const high = advisory("GHSA-1", "a", "high");
  const critical = advisory("GHSA-2", "b", "critical");
  const moderate = advisory("GHSA-3", "c", "moderate");
  const devHigh = advisory("GHSA-4", "tool", "high");

  test("high and critical advisories in production block", () => {
    const result = evaluate([high, critical, moderate], [high, critical, moderate], new Set());
    assert.deepEqual(
      result.blocking.map((item) => item.id),
      ["GHSA-1", "GHSA-2"],
    );
    assert.deepEqual(
      result.warnings.map((item) => item.id),
      ["GHSA-3"],
    );
  });

  test("a serious advisory that is only in development tools warns", () => {
    const result = evaluate([], [devHigh], new Set());
    assert.deepEqual(result.blocking, []);
    assert.deepEqual(
      result.warnings.map((item) => item.id),
      ["GHSA-4"],
    );
  });

  test("an accepted advisory neither blocks nor warns", () => {
    const result = evaluate([high], [high], new Set(["GHSA-1"]));
    assert.deepEqual(result.blocking, []);
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(
      result.accepted.map((item) => item.id),
      ["GHSA-1"],
    );
  });

  test("the same advisory id in another package is not covered by an acceptance of the first only when the id differs", () => {
    const result = evaluate([high, critical], [high, critical], new Set(["GHSA-1"]));
    assert.deepEqual(
      result.blocking.map((item) => item.id),
      ["GHSA-2"],
    );
  });

  test("no advisories means nothing to report", () => {
    assert.deepEqual(evaluate([], [], new Set()), { blocking: [], warnings: [], accepted: [] });
  });
});
