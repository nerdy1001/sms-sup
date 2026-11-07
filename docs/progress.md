# Progress

Tasks come from the delivery plan. **In progress** means the code was handed over but a step that
only you can do is still pending. **Delivered** means the work was handed over and is ready to check.
**Complete** means it was accepted. Each row links to a record that says what was asked, what was built and how to check it.

| Task | Title | Milestone | Status | Date | Record |
|---|---|---|---|---|---|
| FN-01 | Repository, coding standards, module boundary checks | M1-A | Complete | 2026-10-26 | [FN-01](tasks/FN-01.md) |
| FN-02 | CI pipeline: tests, dependency, static and secret scans | M1-A | Complete | 2026-10-27 | [FN-02](tasks/FN-02.md) |
| FN-03 | Staging environment as code (core zone) | M1-A | In progress | 2026-10-27 | [FN-03](tasks/FN-03.md) |
| FN-04 | PostgreSQL, migrations, row-level security, seed data | M1-A | Complete | 2026-10-28 | [FN-04](tasks/FN-04.md) |
| FN-05 | Application skeleton: configuration, logging, errors, API contract | M1-A | Complete | 2026-11-04 | [FN-05](tasks/FN-05.md) |
| FN-06 | Staff front-end shell: layout, routing, English and French, accessible components | M1-A | Complete | 2026-11-05 | [FN-06](tasks/FN-06.md) |
| FN-07 | Audit hooks for writes and reads | M1-A | Complete | 2026-11-05 | [FN-07](tasks/FN-07.md) |
| FN-08 | Synthetic data generator | M1-A | Delivered | 2026-11-05 | [FN-08](tasks/FN-08.md) |
| DX-01 | ESLint, Prettier and readable development logs (added after FN-05) | M1-A | Complete | 2026-11-05 | [DX-01](tasks/DX-01.md) |

## Up next

FN-01, FN-02, FN-04, FN-05, FN-06, FN-07 and DX-01 are complete. FN-03 is in progress: its code is delivered, but the staging server has
not been created (it needs a payment card), so nothing there has run. The full list of tasks, with
estimates, is in the delivery plan.

Done after FN-05, with your agreement (2026-11-04): the migration runner now uses `pg`, and the staging
deployment migrates the database and sets the password of the application role (FN-04 follow-up, ADR 0005
decision 10). `npm run dev` shows readable logs
through `pino-pretty` (guide 5, "Readable logs"). ESLint and Prettier followed on 2026-11-05 as [DX-01](tasks/DX-01.md), [FN-07](tasks/FN-07.md), [FN-08](tasks/FN-08.md).

FN-08 is delivered and waits for your check.

FN-03 becomes Delivered after the staging runbook has been followed once and the checks in its part E
pass. The open items of FN-02 to FN-05 are listed in their records: [FN-02](tasks/FN-02.md),
[FN-03](tasks/FN-03.md), [FN-04](tasks/FN-04.md), [FN-05](tasks/FN-05.md), [FN-06](tasks/FN-06.md), [DX-01](tasks/DX-01.md), [FN-07](tasks/FN-07.md).
