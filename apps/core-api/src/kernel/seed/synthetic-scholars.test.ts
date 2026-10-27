import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createRandom, DEFAULT_SEED, generateSyntheticScholars } from "./synthetic-scholars.ts";

describe("synthetic scholars", () => {
  const scholars = generateSyntheticScholars();

  test("there are 200 by default", () => {
    assert.equal(scholars.length, 200);
  });

  test("the same seed gives the same people, another seed gives others", () => {
    assert.deepEqual(generateSyntheticScholars(50, DEFAULT_SEED), generateSyntheticScholars(50, DEFAULT_SEED));
    assert.notDeepEqual(generateSyntheticScholars(50, 1), generateSyntheticScholars(50, 2));
  });

  test("identifiers and e-mail addresses are unique and clearly synthetic", () => {
    assert.equal(new Set(scholars.map((item) => item.id)).size, 200);
    assert.equal(new Set(scholars.map((item) => item.email)).size, 200);
    for (const item of scholars) {
      assert.match(item.id, /^SYN-\d{6}$/);
      assert.match(item.email, /^syn\d{6}@example\.invalid$/);
      assert.equal(item.synthetic, true);
    }
  });

  test("the fields are plausible", () => {
    for (const item of scholars) {
      assert.match(item.birthDate, /^(199[6-9]|200[0-6])-(0[1-9]|1[0-2])-(0[1-9]|1\d|2[0-8])$/);
      assert.ok(item.firstYear >= 2021 && item.firstYear <= 2025);
      assert.ok(["F", "M"].includes(item.sex));
      assert.ok(["licence", "master", "doctorate"].includes(item.level));
    }
  });

  test("both sexes and all levels appear", () => {
    assert.equal(new Set(scholars.map((item) => item.sex)).size, 2);
    assert.equal(new Set(scholars.map((item) => item.level)).size, 3);
  });

  test("a silly count is refused", () => {
    assert.throws(() => generateSyntheticScholars(-1), RangeError);
    assert.throws(() => generateSyntheticScholars(1.5), RangeError);
    assert.deepEqual(generateSyntheticScholars(0), []);
  });
});

test("the random generator stays between 0 and 1 and repeats", () => {
  const first = createRandom(7);
  const second = createRandom(7);
  for (let index = 0; index < 1000; index += 1) {
    const value = first();
    assert.ok(value >= 0 && value < 1);
    assert.equal(value, second());
  }
});
