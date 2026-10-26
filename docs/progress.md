# Progress

Tasks come from the delivery plan. **Delivered** means the work was handed over. **Complete** means it was
accepted. Each row links to a record that says what was asked, what was built and how to check it.

| Task | Title | Milestone | Status | Date | Record |
|---|---|---|---|---|---|
| FN-01 | Repository, coding standards, module boundary checks | M1-A | Complete | 2026-10-26 | [FN-01](tasks/FN-01.md) |
| FN-02 | CI pipeline: tests, dependency, static and secret scans | M1-A | Delivered | 2026-10-26 | [FN-02](tasks/FN-02.md) |

## Up next

FN-01 is complete and FN-02 is delivered. Foundations continue in this order in the plan: FN-03 (staging
environment as code), FN-04 (PostgreSQL, migrations, row-level security, seed data), FN-05 (application
skeleton: configuration, logging, errors, API contract). The full list, with estimates, is in the
delivery plan. Before FN-03, run the FN-02 pipeline once on GitHub (see
[its record](tasks/FN-02.md)).
