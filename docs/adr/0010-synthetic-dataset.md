# ADR 0010: The synthetic dataset

Status: accepted (2026-11-05, task FN-08)

## Context

Staging, demonstrations and tests need people, schools, payments and documents, and the system must never hold
real scholars' data outside production. Until FN-08 the repository had a generator of 200 isolated scholars with no
history. The modules that come next (registry, progress, payments, documents, contacts) each need linked records
that look like a real caseload, including the awkward cases that cause most of the support work. No table for
them exists yet.

## Decisions

1. **One generator makes the whole life of a scholarship as linked records.** Scholars, attaches, institutions,
   academic years, documents, phone numbers and payments, in `kernel/seed/synthetic-dataset.ts`. The same
   seed always gives the same data. Time is a fixed reference date (2026-11-05), never the clock.
2. **Nothing is created in the database by this task.** The data is a plain object, and a command writes it to a
   JSON file (`npm run seed:data`). The module that owns each table loads its part when the table exists, so the
   dataset never forces a schema before the module task has designed it.
3. **Synthetic by construction, and checked.** Identifiers start with `SYN-`, e-mail addresses end in
   `@example.invalid`, phone numbers have a national part starting with `000` (no operator issues those), and
   institutions are named "Synthetic ...". `assertSyntheticDataset` checks all of this and a loader must call it
   first.
4. **Money is a whole number of CFA francs.** The franc has no smaller unit and the repository forbids floating
   point money. The amounts are plausible and are not the Ministry's rates; the payment module replaces them.
5. **Awkward cases are labelled, and the label is exact.** Each scholar has `edgeCases`. A label means the
   scholar has at least one such case, and its absence means none. The cases are a repeated year, a phone number
   changed abroad, two people with the same names, a late payment, a rejected payment, a missing certificate and
   no attache. With 30 scholars or more every label appears at least once.
6. **A repeated year is allowed once per programme** and extends the schedule by one year.
7. **A separate random stream** (seed mixed with a constant) is used for the records built on top of the base
   scholars, so the identity fields of `generateSyntheticScholars` do not change when the dataset grows.

## Consequences

- Module tasks get realistic linked data without waiting for each other, and tests can ask for a case by name.
- Changing the generator changes the data for a given seed. `GENERATOR_VERSION` is written in the output so a
  file can be told apart from a newer one.
- The reference lists (countries, institutions, amounts) are assumptions. They have not been compared with the
  Ministry's real scales or with the specification in detail.

## When to revisit

- When the payment module defines the real scales and statuses: replace the amounts and statuses here.
- When a module loads its part for the first time: check that the shape fits the table it designed.
- When a case that occurs in real work is missing from the labels.
