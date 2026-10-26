# Working agreement

This file is short on purpose. The rules that matter are checked by `npm run check`; this file
explains how to work with them.

## The loop

1. Start from `main`. Create a branch named after the task: `feat/rg-01-scholar-record`.
2. Make small commits. Open a pull request early, even when you are the only reviewer: the checks
   run on it and the description is the record of why.
3. The pull request title follows `type(scope): subject`, for example `feat(rg): add scholar
   identifier`. The scope is the module code in lowercase (`rg`, `cm`, `fn` and so on). The title
   becomes the commit message, because pull requests are merged by squashing.
4. Merge when `checks`, `audit`, `secret-history` and `pr-title` are green. Delete the branch.

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `build`, `ci`, `perf`, `security`, `revert`.
Add `!` after the scope for a change that breaks something others depend on.

## Before every pull request

    npm run check

It runs the type check, the architecture, coding, security, secret and dependency rules, the
documentation check and the tests, which is what the `checks` job runs. The `audit` and `secret-history`
jobs have their own commands (`npm run audit:deps`, `npm run scan:secrets`). Fix failures at the cause. Do not weaken a rule to make a change pass: if a rule is
wrong, change it in its own pull request, with the reason (docs/boundaries.md explains how).

## Definition of done for a task

- The behaviour in the delivery plan works, and its failure cases are tested (wrong input, missing
  permission, empty data, the second submission of the same request).
- `npm run check` passes with no new suppression, or each new suppression has a reason a stranger
  would accept.
- Nothing personal in code, tests, fixtures, logs or error messages. Test data is synthetic (FN-08).
- The module README says what the module owns, and the module map is still true.
- The documentation is updated (see docs/README.md): the task record in docs/tasks, the row in
  docs/progress.md, and any guide page, glossary entry or reference page the change made untrue.
  `npm run check` verifies that records, the progress log and links agree.
- The pull request template is complete.

## Coding standards

The enforced list is in docs/boundaries.md. The ones that need judgement:

- **Names say what, not how.** `confirmReceipt`, not `handleData`. Domain words come from the SRS:
  scholar, attaché, commitment, receipt, repetition.
- **Small functions, early returns, no clever code.** Someone who is not you will read this in a year.
- **Money is a whole number of the local currency.** No decimals anywhere.
- **Dates and times are stored in UTC and shown in Africa/Douala.** Never store a local time.
- **Every user-visible text exists in French and English.** No text is written into code, only
  message keys. French is the default language for staff.
- **Errors tell the user what to do and tell the log what happened.** They never contain a bank
  number, an identity number, a password, a code or a token.
- **Validate at the edge, trust inside.** Input is checked by a schema in the `http` layer; use cases
  receive typed values.
- **Queries use parameters.** Never build SQL text from user input, not even for column names.
- **Comments explain why.** The code already says what.

## Dependencies

Every dependency is an attack surface that the Ministry cannot monitor. Before adding one:

1. Can Node's own modules do it in a few lines? Then do that.
2. Is it maintained, widely used and small? Look at its own dependencies too.
3. Add it to the `dependencies` of the one package that uses it, with an exact version (the
   repository's `.npmrc` does this by default), and write the reason in the pull request.

Dependabot merges patch and minor updates by itself once every check passes; major updates wait for you.
A vulnerability that blocks the pipeline is fixed, or accepted for at most 90 days in
`security/accepted-risks.json` with a written reason.

Install scripts of dependencies never run (`ignore-scripts` in `.npmrc`). If a dependency cannot work
without one, that is a reason to choose another dependency.

## Adding a module

    npm run new:module -- RG --depends configuration

The code must be in `plannedModules` in `tools/rules.config.ts` (and in docs/architecture/modules.md).
The generator creates the layout and a test; `npm run check` must pass before you add anything to it.
A new dependency between modules is a one-line change in `module.json`, and a line in the pull
request saying why the dependency is right.

## Secrets

Never commit a secret, a key, a certificate, a real record or a `.env` file. The `.gitignore` blocks
the usual names; do not rely on it. A secret that was committed is a leaked secret, even after
deletion: rotate it, then tell whoever is responsible for the system.
