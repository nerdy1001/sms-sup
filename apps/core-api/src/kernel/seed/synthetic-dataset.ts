import {
  ATTACHE_GIVEN_NAMES,
  COUNTRIES,
  EXTRA_FAMILY_NAMES,
  FIELDS_OF_STUDY,
  INSTALLATION_ALLOWANCE_XAF,
  INSTITUTIONS,
  REJECTION_CODES,
  TERMS,
} from "./synthetic-reference.ts";
import { createRandom, DEFAULT_SEED, generateSyntheticScholars, type SyntheticScholar } from "./synthetic-scholars.ts";

/**
 * A synthetic dataset: the whole life of scholarships, from the first year to completion, as linked records.
 * Scholars, the attaches who follow them, the institutions, each academic year, the documents, the phone
 * numbers and the payments. The same seed always gives the same data, so a bug seen on one computer can be
 * reproduced on another.
 *
 * Nothing is real. Identifiers start with SYN, e-mail addresses end in .invalid, phone numbers cannot have been
 * issued (see synthetic-reference.ts), and `assertSyntheticDataset` checks all of this before anything loads it.
 *
 * It holds deliberately awkward cases too (a repeated year, a changed phone number, two people with the same
 * name, a late or rejected payment, a missing certificate, a scholar with no attache), each labelled in
 * `edgeCases`, so that a test or a demonstration can ask for them by name. An unlabelled scholar has none of
 * them: a label means "has at least one", and its absence means "has none".
 *
 * This file only makes the data. The module that owns each table loads its part when the table exists.
 */

/** "Today" inside the dataset. A fixed date, so that the data does not change with the clock. */
export const REFERENCE_DATE = "2026-11-05";
/** The academic year in progress on the reference date (it started in October 2026). */
export const CURRENT_YEAR = 2026;
export const MAX_SCHOLARS = 20_000;
export const GENERATOR_VERSION = "synthetic-dataset/1";

export type EdgeCase =
  "repeat_year" | "changed_phone_abroad" | "similar_names" | "late_payment" | "rejected_payment" | "missing_certificate" | "no_attache";

/** The share of scholars that carry each label. With 30 scholars or more, each label appears at least once. */
export const EDGE_CASE_SHARES: Readonly<Record<EdgeCase, number>> = {
  repeat_year: 0.06,
  changed_phone_abroad: 0.08,
  similar_names: 0.03,
  late_payment: 0.1,
  rejected_payment: 0.04,
  missing_certificate: 0.05,
  no_attache: 0.03,
};
export const EDGE_CASES = Object.keys(EDGE_CASE_SHARES) as EdgeCase[];

export type ScholarStatus = "active" | "suspended" | "withdrawn" | "completed";
export type YearOutcome = "passed" | "repeated" | "in_progress" | "abandoned";
export type PaymentKind = "allowance" | "installation" | "tuition";
export type PaymentStatus = "paid" | "paid_late" | "pending" | "scheduled" | "held" | "rejected";
export type DocumentType = "certificate_of_schooling" | "transcript";
export type DocumentStatus = "received" | "pending" | "missing";

export interface DatasetInstitution {
  readonly synthetic: true;
  readonly id: string;
  readonly name: string;
  readonly countryCode: string;
  readonly country: string;
  readonly city: string;
  readonly tuitionPerYearXaf: number;
}

/** A member of staff who follows scholars. Not a row of platform.users: the registry module maps them. */
export interface DatasetAttache {
  readonly synthetic: true;
  readonly id: string;
  readonly givenName: string;
  readonly familyName: string;
  readonly email: string;
}

export interface DatasetScholar {
  readonly synthetic: true;
  readonly id: string;
  readonly givenName: string;
  readonly familyName: string;
  readonly sex: "F" | "M";
  readonly birthDate: string;
  readonly email: string;
  readonly level: SyntheticScholar["level"];
  readonly fieldOfStudy: string;
  readonly institutionId: string;
  readonly firstYear: number;
  readonly status: ScholarStatus;
  /** The academic year (by its first calendar year) of the last recorded year, for a completed or withdrawn scholar. */
  readonly endYear: number | null;
  readonly attacheId: string | null;
  readonly edgeCases: readonly EdgeCase[];
}

export interface DatasetYear {
  readonly synthetic: true;
  readonly scholarId: string;
  /** The first calendar year of the academic year: 2025 means 2025-2026. */
  readonly year: number;
  readonly outcome: YearOutcome;
}

export interface DatasetDocument {
  readonly synthetic: true;
  readonly id: string;
  readonly scholarId: string;
  readonly year: number;
  readonly type: DocumentType;
  readonly status: DocumentStatus;
}

export interface DatasetPhone {
  readonly synthetic: true;
  readonly scholarId: string;
  readonly phone: string;
  /** The date from which this number is the one to use. */
  readonly from: string;
  readonly kind: "before_departure" | "abroad";
}

export interface DatasetPayment {
  readonly synthetic: true;
  readonly id: string;
  readonly scholarId: string;
  readonly kind: PaymentKind;
  /** For example "2025-T1". Installation and tuition use "2025-installation" and "2025-tuition". */
  readonly period: string;
  /** A whole number of CFA francs. */
  readonly amountXaf: number;
  readonly dueDate: string;
  readonly paidDate: string | null;
  readonly status: PaymentStatus;
  readonly rejectionCode: string | null;
}

export interface SyntheticDataset {
  readonly meta: { readonly generator: string; readonly seed: number; readonly scholarCount: number; readonly referenceDate: string };
  readonly institutions: readonly DatasetInstitution[];
  readonly attaches: readonly DatasetAttache[];
  readonly scholars: readonly DatasetScholar[];
  readonly years: readonly DatasetYear[];
  readonly documents: readonly DatasetDocument[];
  readonly phones: readonly DatasetPhone[];
  readonly payments: readonly DatasetPayment[];
}

export interface DatasetOptions {
  readonly scholars?: number;
  readonly seed?: number;
}

type Mutable<T> = { -readonly [Key in keyof T]: T[Key] };

const DURATION: Readonly<Record<SyntheticScholar["level"], number>> = { licence: 3, master: 2, doctorate: 3 };
const pad = (value: number, width: number): string => String(value).padStart(width, "0");

/** Adds days to an ISO date. Pure calendar arithmetic: it never reads the clock. */
export function addDays(isoDate: string, days: number): string {
  const [year = 0, month = 1, day = 1] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}
const daysBetween = (from: string, to: string): number => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

/** A phone number that no operator can have issued: the national part starts with 000. */
const phoneNumber = (callingCode: string, serial: number): string => `+${callingCode}000${pad(serial % 1_000_000, 6)}`;

export function generateDataset(options: DatasetOptions = {}): SyntheticDataset {
  const count = options.scholars ?? 200;
  const seed = options.seed ?? DEFAULT_SEED;
  if (!Number.isInteger(count) || count < 0 || count > MAX_SCHOLARS)
    throw new RangeError(`scholars must be a whole number between 0 and ${MAX_SCHOLARS}`);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw new RangeError("seed must be a whole number between 0 and 4294967295");

  const random = createRandom((seed ^ 0x9e3779b9) >>> 0);
  const below = (limit: number): number => Math.floor(random() * limit);
  const pick = <T>(items: readonly T[]): T => items[below(items.length)] as T;
  const chance = (share: number): boolean => random() < share;
  const between = (low: number, high: number): number => low + below(high - low + 1);

  const institutions: DatasetInstitution[] = INSTITUTIONS.map((template, index) => {
    const country = COUNTRIES.find((item) => item.code === template.countryCode);
    if (country === undefined) throw new Error(`The reference list has no country ${template.countryCode}.`);
    return {
      synthetic: true,
      id: `SYN-INS-${pad(index + 1, 3)}`,
      name: `Synthetic ${template.kind} of ${template.city}`,
      countryCode: country.code,
      country: country.name,
      city: template.city,
      tuitionPerYearXaf: template.tuitionPerYearXaf,
    };
  });

  const attacheCount = Math.max(1, Math.ceil(count / 40));
  const attaches: DatasetAttache[] = Array.from({ length: attacheCount }, (_unused, index) => ({
    synthetic: true,
    id: `SYN-ATT-${pad(index + 1, 3)}`,
    givenName: pick(ATTACHE_GIVEN_NAMES),
    familyName: pick(EXTRA_FAMILY_NAMES),
    email: `att${pad(index + 1, 3)}@example.invalid`,
  }));

  // Which scholars carry which label, decided first so that the data can be built to match.
  const labelled = chooseLabelled(count, random);
  const hasLabel = (index: number, label: EdgeCase): boolean => labelled[label].has(index);

  const base = generateSyntheticScholars(count, seed);
  const scholars: Mutable<DatasetScholar>[] = [];
  const years: DatasetYear[] = [];
  const documents: DatasetDocument[] = [];
  const phones: DatasetPhone[] = [];
  const payments: DatasetPayment[] = [];
  let documentNumber = 0;
  let paymentNumber = 0;

  base.forEach((person, index) => {
    const institution = pick(institutions);
    const country = COUNTRIES.find((item) => item.code === institution.countryCode) ?? COUNTRIES[0];
    if (country === undefined) throw new Error("The reference list has no country.");

    let givenName = person.givenName;
    let familyName = person.familyName;
    if (hasLabel(index, "similar_names") && index > 0) {
      // The same name as an earlier scholar, with another birth date and number: a duplicate that is not one.
      const twin = scholars[below(index)];
      if (twin !== undefined) {
        givenName = twin.givenName;
        familyName = twin.familyName;
      }
    } else if (chance(0.15)) {
      familyName = pick(EXTRA_FAMILY_NAMES);
    }

    // The schedule: the years a scholar needs, one more when a year is repeated.
    const repeats = hasLabel(index, "repeat_year");
    const needed = DURATION[person.level] + (repeats ? 1 : 0);
    const lastScheduled = person.firstYear + needed - 1;
    const lastRecorded = Math.min(lastScheduled, CURRENT_YEAR);
    const finished = lastScheduled < CURRENT_YEAR;
    const pastYears = lastRecorded - person.firstYear + (finished ? 1 : 0);
    const repeatedYear = repeats ? person.firstYear + below(Math.max(1, Math.min(pastYears, DURATION[person.level]))) : null;

    let status: ScholarStatus = finished ? "completed" : "active";
    if (status === "active" && chance(0.05)) status = "withdrawn";
    else if (status === "active" && chance(0.03)) status = "suspended";

    const scholarYears: Mutable<DatasetYear>[] = [];
    for (let year = person.firstYear; year <= lastRecorded; year += 1) {
      const isLast = year === lastRecorded;
      let outcome: YearOutcome = year === repeatedYear ? "repeated" : "passed";
      if (isLast && !finished) outcome = status === "withdrawn" ? "abandoned" : "in_progress";
      scholarYears.push({ synthetic: true, scholarId: person.id, year, outcome });
    }
    years.push(...scholarYears);

    const attached = !hasLabel(index, "no_attache");
    scholars.push({
      synthetic: true,
      id: person.id,
      givenName,
      familyName,
      sex: person.sex,
      birthDate: person.birthDate,
      email: person.email,
      level: person.level,
      fieldOfStudy: pick(FIELDS_OF_STUDY),
      institutionId: institution.id,
      firstYear: person.firstYear,
      status,
      endYear: status === "completed" || status === "withdrawn" ? lastRecorded : null,
      attacheId: attached ? pick(attaches).id : null,
      edgeCases: EDGE_CASES.filter((label) => hasLabel(index, label)),
    });

    // Phone numbers: one collected before departure; a second, abroad, for the scholars who changed number.
    const serial = (index + 1) * 7919;
    phones.push({
      synthetic: true,
      scholarId: person.id,
      phone: phoneNumber("237", serial),
      from: `${person.firstYear}-07-${pad(between(1, 28), 2)}`,
      kind: "before_departure",
    });
    if (hasLabel(index, "changed_phone_abroad")) {
      const changeYear = between(person.firstYear, lastRecorded);
      phones.push({
        synthetic: true,
        scholarId: person.id,
        phone: phoneNumber(country.callingCode, serial + 1),
        from: `${changeYear}-${pad(between(1, 9), 2)}-${pad(between(1, 28), 2)}`,
        kind: "abroad",
      });
    }

    // Documents: a certificate of schooling for each year, a transcript for each year that was finished.
    const missingYear = hasLabel(index, "missing_certificate")
      ? status === "completed"
        ? lastRecorded
        : pickYear(scholarYears, random)
      : null;
    for (const entry of scholarYears) {
      documentNumber += 1;
      const inProgress = entry.outcome === "in_progress";
      let certificate: DocumentStatus = inProgress && chance(0.3) ? "pending" : "received";
      if (entry.year === missingYear) certificate = "missing";
      documents.push({
        synthetic: true,
        id: `SYN-DOC-${pad(documentNumber, 7)}`,
        scholarId: person.id,
        year: entry.year,
        type: "certificate_of_schooling",
        status: certificate,
      });
      if (entry.outcome === "passed" || entry.outcome === "repeated") {
        documentNumber += 1;
        documents.push({
          synthetic: true,
          id: `SYN-DOC-${pad(documentNumber, 7)}`,
          scholarId: person.id,
          year: entry.year,
          type: "transcript",
          status: "received",
        });
      }
    }

    // Payments: the allowance in three terms, the installation allowance once, tuition when the institution charges it.
    const own: DatasetPayment[] = [];
    const add = (kind: PaymentKind, period: string, amountXaf: number, dueDate: string): void => {
      paymentNumber += 1;
      own.push(makePayment(`SYN-PAY-${pad(paymentNumber, 7)}`, person.id, kind, period, amountXaf, dueDate, status, random));
    };
    for (const entry of scholarYears) {
      if (entry.year === person.firstYear)
        add("installation", `${entry.year}-installation`, INSTALLATION_ALLOWANCE_XAF, `${entry.year}-10-01`);
      for (const term of TERMS) {
        const due = `${entry.year + term.yearOffset}-${pad(term.month, 2)}-15`;
        // A scholar who abandoned a year is paid only until the end of the term in which they left.
        const stillStudying = entry.outcome !== "abandoned" || term.label === "T1";
        if (stillStudying && daysBetween(REFERENCE_DATE, due) <= 90)
          add("allowance", `${entry.year}-${term.label}`, country.allowancePerTermXaf, due);
      }
      const tuitionDue = `${entry.year}-11-15`;
      if (institution.tuitionPerYearXaf > 0 && entry.outcome !== "abandoned" && daysBetween(REFERENCE_DATE, tuitionDue) <= 90) {
        add("tuition", `${entry.year}-tuition`, institution.tuitionPerYearXaf, tuitionDue);
      }
    }
    applyPaymentLabels(own, index, hasLabel, random);
    payments.push(...own);
  });

  return {
    meta: { generator: GENERATOR_VERSION, seed, scholarCount: count, referenceDate: REFERENCE_DATE },
    institutions,
    attaches,
    scholars,
    years,
    documents,
    phones,
    payments,
  };
}

/** Picks, for each label, which scholars carry it: a share of them, and at least one when there are 30 or more. */
function chooseLabelled(count: number, random: () => number): Record<EdgeCase, Set<number>> {
  const result = {} as Record<EdgeCase, Set<number>>;
  for (const label of EDGE_CASES) {
    const wanted = Math.round(count * EDGE_CASE_SHARES[label]);
    const quota = Math.min(count, count >= 30 ? Math.max(1, wanted) : wanted);
    const order = Array.from({ length: count }, (_unused, index) => index);
    for (let index = order.length - 1; index > 0; index -= 1) {
      const other = Math.floor(random() * (index + 1));
      [order[index], order[other]] = [order[other] as number, order[index] as number];
    }
    // The first scholar is kept free of "similar_names", which needs an earlier scholar to copy.
    result[label] = new Set(order.filter((value) => label !== "similar_names" || value > 0).slice(0, quota));
  }
  return result;
}

function pickYear(years: readonly DatasetYear[], random: () => number): number | null {
  const entry = years[Math.floor(random() * years.length)];
  return entry === undefined ? null : entry.year;
}

/** The ordinary state of a payment on the reference date. Lateness and rejection come only from labels. */
function makePayment(
  id: string,
  scholarId: string,
  kind: PaymentKind,
  period: string,
  amountXaf: number,
  dueDate: string,
  scholarStatus: ScholarStatus,
  random: () => number,
): DatasetPayment {
  const daysSinceDue = daysBetween(dueDate, REFERENCE_DATE);
  const make = (status: PaymentStatus, paidDate: string | null): DatasetPayment => ({
    synthetic: true,
    id,
    scholarId,
    kind,
    period,
    amountXaf,
    dueDate,
    paidDate,
    status,
    rejectionCode: null,
  });
  if (daysSinceDue < 0) return make("scheduled", null);
  if (scholarStatus === "suspended" && daysSinceDue < 120) return make("held", null);
  if (daysSinceDue > 30) return make("paid", addDays(dueDate, Math.floor(random() * 10)));
  return random() < 0.7 ? make("paid", addDays(dueDate, Math.floor(random() * Math.max(1, daysSinceDue)))) : make("pending", null);
}

/** Gives the scholars with a payment label the payment that the label promises. */
function applyPaymentLabels(
  own: DatasetPayment[],
  index: number,
  hasLabel: (index: number, label: EdgeCase) => boolean,
  random: () => number,
): void {
  const settled = own.filter((payment) => payment.status === "paid" && daysBetween(payment.dueDate, REFERENCE_DATE) > 130);
  const choose = (): number => {
    const target = settled[Math.floor(random() * settled.length)];
    return target === undefined ? -1 : own.indexOf(target);
  };
  if (hasLabel(index, "late_payment")) {
    const at = choose();
    const payment = own[at];
    if (payment !== undefined)
      own[at] = { ...payment, status: "paid_late", paidDate: addDays(payment.dueDate, 45 + Math.floor(random() * 76)) };
  }
  if (hasLabel(index, "rejected_payment")) {
    const at = choose();
    const payment = own[at];
    if (payment !== undefined) {
      const code = REJECTION_CODES[Math.floor(random() * REJECTION_CODES.length)] ?? "account_closed";
      own[at] = { ...payment, status: "rejected", paidDate: null, rejectionCode: code };
    }
  }
}

/**
 * Refuses a dataset that is not clearly synthetic. A loader calls this before it writes anything, so that
 * real data, or data edited by hand into something that looks real, can never go through the same door.
 */
export function assertSyntheticDataset(dataset: SyntheticDataset): void {
  const problems: string[] = [];
  const check = (condition: boolean, message: string): void => {
    if (!condition && problems.length < 10) problems.push(message);
  };
  const groups: readonly (readonly { readonly synthetic: boolean; readonly id?: string; readonly scholarId?: string }[])[] = [
    dataset.institutions,
    dataset.attaches,
    dataset.scholars,
    dataset.years,
    dataset.documents,
    dataset.phones,
    dataset.payments,
  ];
  for (const group of groups)
    for (const record of group)
      check(record.synthetic === true, `A record is not marked synthetic (${record.id ?? record.scholarId ?? "?"}).`);
  for (const item of [...dataset.institutions, ...dataset.attaches, ...dataset.scholars])
    check(item.id.startsWith("SYN-"), `Identifier ${item.id} does not start with SYN-.`);
  for (const item of [...dataset.documents, ...dataset.payments])
    check(item.id.startsWith("SYN-"), `Identifier ${item.id} does not start with SYN-.`);
  for (const item of [...dataset.attaches, ...dataset.scholars])
    check(item.email.endsWith("@example.invalid"), `E-mail ${item.email} is not on example.invalid.`);
  for (const item of dataset.phones) check(/^\+\d{1,3}000\d{6}$/.test(item.phone), `Phone number ${item.phone} is not a synthetic one.`);
  for (const item of dataset.payments)
    check(
      Number.isSafeInteger(item.amountXaf) && item.amountXaf > 0,
      `Payment ${item.id} has an amount that is not a whole number of francs.`,
    );
  if (problems.length > 0) throw new Error(`Not a synthetic dataset:\n- ${problems.join("\n- ")}`);
}
