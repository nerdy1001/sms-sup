import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { run } from "./seed-data.ts";

const withDirectory = (work: (directory: string) => void): void => {
  const directory = mkdtempSync(join(tmpdir(), "seed-data-"));
  try {
    work(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

test("writes a dataset file and prints a summary", () =>
  withDirectory((directory) => {
    const out = join(directory, "nested", "data.json");
    const output: string[] = [];
    assert.equal(
      run(["--count", "40", "--seed", "5", "--out", out], (text) => output.push(text)),
      0,
    );
    const parsed = JSON.parse(readFileSync(out, "utf8")) as { scholars: unknown[]; meta: { seed: number } };
    assert.equal(parsed.scholars.length, 40);
    assert.equal(parsed.meta.seed, 5);
    assert.match(output.join("\n"), /40 scholars/);
  }));

test("does not replace an existing file without --force", () =>
  withDirectory((directory) => {
    const out = join(directory, "data.json");
    writeFileSync(out, "keep");
    assert.equal(
      run(["--count", "5", "--out", out], () => undefined),
      1,
    );
    assert.equal(readFileSync(out, "utf8"), "keep");
    assert.equal(
      run(["--count", "5", "--out", out, "--force"], () => undefined),
      0,
    );
  }));

test("rejects an unknown option and a bad count", () =>
  withDirectory((directory) => {
    assert.throws(() => run(["--nope"], () => undefined));
    assert.throws(() => run(["--count", "abc", "--out", join(directory, "x.json")], () => undefined), RangeError);
  }));
