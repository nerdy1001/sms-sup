# Progress

Tasks come from the delivery plan. **In progress** means the code was handed over but a step that
only you can do is still pending. **Delivered** means the work was handed over and is ready to check.
**Complete** means it was accepted. Each row links to a record that says what was asked, what was built and how to check it.

| Task | Title | Milestone | Status | Date | Record |
|---|---|---|---|---|---|
| FN-01 | Repository, coding standards, module boundary checks | M1-A | Complete | 2026-10-26 | [FN-01](tasks/FN-01.md) |
| FN-02 | CI pipeline: tests, dependency, static and secret scans | M1-A | Complete | 2026-10-27 | [FN-02](tasks/FN-02.md) |
| FN-03 | Staging environment as code (core zone) | M1-A | In progress | 2026-10-27 | [FN-03](tasks/FN-03.md) |
| FN-04 | PostgreSQL, migrations, row-level security, seed data | M1-A | Delivered | 2026-10-27 | [FN-04](tasks/FN-04.md) |

## Up next

FN-01 and FN-02 are complete. FN-03 is in progress: its code is delivered, but the staging server has
not been created (it needs a payment card), so nothing there has run. FN-04 is delivered and waits for
its first run on your local database ([runbook](runbooks/local-database.md)). Next in the plan: FN-05
(application skeleton: configuration, logging, errors, API contract, the database driver and the real
`npm run dev`). The full list, with estimates, is in the delivery plan.

FN-03 becomes Delivered after the staging runbook has been followed once and the checks in its part E
pass. The open items of FN-02, FN-03 and FN-04 are listed in their records: [FN-02](tasks/FN-02.md),
[FN-03](tasks/FN-03.md), [FN-04](tasks/FN-04.md).
