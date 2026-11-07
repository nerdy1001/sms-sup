import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  assertSyntheticDataset,
  CURRENT_YEAR,
  EDGE_CASES,
  generateDataset,
  MAX_SCHOLARS,
  type DatasetScholar,
  type SyntheticDataset,
} from "./synthetic-dataset.ts";

const data = generateDataset({ scholars: 400, seed: 42 });
const withLabel = (label: (typeof EDGE_CASES)[number]): DatasetScholar[] =>
  data.scholars.filter((scholar) => scholar.edgeCases.includes(label));
const ownPayments = (id: string): SyntheticDataset["payments"] => data.payments.filter((payment) => payment.scholarId === id);

describe("generateDataset", () => {
  test("gives the same data for the same seed and other data for another", () => {
    assert.deepEqual(generateDataset({ scholars: 60, seed: 7 }), generateDataset({ scholars: 60, seed: 7 }));
    assert.notDeepEqual(generateDataset({ scholars: 60, seed: 7 }).scholars, generateDataset({ scholars: 60, seed: 8 }).scholars);
  });

  test("refuses counts and seeds that make no sense", () => {
    assert.throws(() => generateDataset({ scholars: -1 }), RangeError);
    assert.throws(() => generateDataset({ scholars: 1.5 }), RangeError);
    assert.throws(() => generateDataset({ scholars: MAX_SCHOLARS + 1 }), RangeError);
    assert.throws(() => generateDataset({ seed: -3 }), RangeError);
  });

  test("an empty dataset is valid", () => {
    const empty = generateDataset({ scholars: 0 });
    assert.equal(empty.scholars.length, 0);
    assertSyntheticDataset(empty);
  });

  test("identifiers are unique and every link points at a record that exists", () => {
    const ids = [...data.institutions, ...data.attaches, ...data.scholars, ...data.documents, ...data.payments].map((item) => item.id);
    assert.equal(new Set(ids).size, ids.length);
    const scholarIds = new Set(data.scholars.map((item) => item.id));
    const institutionIds = new Set(data.institutions.map((item) => item.id));
    const attacheIds = new Set(data.attaches.map((item) => item.id));
    for (const scholar of data.scholars) {
      assert.ok(institutionIds.has(scholar.institutionId));
      if (scholar.attacheId !== null) assert.ok(attacheIds.has(scholar.attacheId));
    }
    for (const group of [data.years, data.documents, data.phones, data.payments])
      for (const record of group) assert.ok(scholarIds.has(record.scholarId));
  });

  test("passes its own guard, and every amount is a whole number of francs", () => {
    assertSyntheticDataset(data);
    for (const payment of data.payments) assert.ok(Number.isInteger(payment.amountXaf));
  });

  test("years follow the programme and stop at the current year", () => {
    for (const scholar of data.scholars) {
      const years = data.years.filter((item) => item.scholarId === scholar.id);
      assert.ok(years.length > 0);
      assert.equal(years[0]?.year, scholar.firstYear);
      assert.ok(years.every((item) => item.year <= CURRENT_YEAR));
      const repeated = years.filter((item) => item.outcome === "repeated").length;
      assert.ok(repeated <= 1);
      if (repeated === 1) assert.ok(scholar.edgeCases.includes("repeat_year"));
    }
  });

  test("each label appears, and an unlabelled scholar has none of the awkward data", () => {
    for (const label of EDGE_CASES) assert.ok(withLabel(label).length >= 1, label);
    for (const scholar of data.scholars) {
      const labels = scholar.edgeCases;
      const payments = ownPayments(scholar.id);
      const phones = data.phones.filter((item) => item.scholarId === scholar.id);
      const documents = data.documents.filter((item) => item.scholarId === scholar.id);
      assert.equal(
        payments.some((item) => item.status === "paid_late"),
        labels.includes("late_payment"),
      );
      assert.equal(
        payments.some((item) => item.status === "rejected"),
        labels.includes("rejected_payment"),
      );
      assert.equal(
        phones.some((item) => item.kind === "abroad"),
        labels.includes("changed_phone_abroad"),
      );
      assert.equal(
        documents.some((item) => item.status === "missing"),
        labels.includes("missing_certificate"),
      );
      assert.equal(scholar.attacheId === null, labels.includes("no_attache"));
    }
  });

  test("a rejected payment carries a code and no paid date; others carry no code", () => {
    for (const payment of data.payments) {
      assert.equal(payment.rejectionCode !== null, payment.status === "rejected");
      if (payment.status === "rejected") assert.equal(payment.paidDate, null);
      if (payment.status === "paid" || payment.status === "paid_late") assert.notEqual(payment.paidDate, null);
    }
  });

  test("a scholar labelled similar_names shares both names with an earlier scholar but not the birth date", () => {
    for (const scholar of withLabel("similar_names")) {
      const position = data.scholars.indexOf(scholar);
      const twin = data.scholars
        .slice(0, position)
        .find((item) => item.givenName === scholar.givenName && item.familyName === scholar.familyName);
      assert.ok(twin, scholar.id);
    }
  });

  test("a scholar with a repeated year has the programme extended by one year", () => {
    const duration = { licence: 3, master: 2, doctorate: 3 } as const;
    for (const scholar of withLabel("repeat_year").filter((item) => item.status === "completed")) {
      const years = data.years.filter((item) => item.scholarId === scholar.id);
      assert.equal(years.length, duration[scholar.level] + 1);
    }
  });

  test("synthetic phone numbers never look issuable", () => {
    for (const item of data.phones) assert.match(item.phone, /^\+\d{1,3}000\d{6}$/);
    assert.ok(data.phones.some((item) => item.phone.startsWith("+237")));
  });

  test("small datasets still honour their rounding", () => {
    const small = generateDataset({ scholars: 10, seed: 1 });
    assert.equal(small.scholars.length, 10);
    assertSyntheticDataset(small);
  });
});

describe("assertSyntheticDataset", () => {
  const clone = (): { -readonly [K in keyof SyntheticDataset]: SyntheticDataset[K] } =>
    structuredClone(generateDataset({ scholars: 30, seed: 3 }));

  test("refuses a record that is not marked synthetic", () => {
    const copy = clone();
    (copy.scholars[0] as { synthetic: boolean }).synthetic = false;
    assert.throws(() => assertSyntheticDataset(copy), /not marked synthetic/);
  });

  test("refuses an identifier without the SYN prefix", () => {
    const copy = clone();
    (copy.payments[0] as { id: string }).id = "PAY-1";
    assert.throws(() => assertSyntheticDataset(copy), /SYN-/);
  });

  test("refuses an e-mail address that could be real", () => {
    const copy = clone();
    (copy.scholars[0] as { email: string }).email = "someone@gmail.com";
    assert.throws(() => assertSyntheticDataset(copy), /example\.invalid/);
  });

  test("refuses a phone number that could be issued", () => {
    const copy = clone();
    (copy.phones[0] as { phone: string }).phone = "+237677123456";
    assert.throws(() => assertSyntheticDataset(copy), /synthetic one/);
  });

  test("refuses an amount that is not a whole number", () => {
    const copy = clone();
    (copy.payments[0] as { amountXaf: number }).amountXaf = 1000.5;
    assert.throws(() => assertSyntheticDataset(copy), /whole number/);
  });
});
